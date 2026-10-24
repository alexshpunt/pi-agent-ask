import { isAbsolute } from "node:path";
import type {
	AskOption,
	AskParams,
	AskQuestion,
	AskQuestionInput,
	AskValidationIssue,
} from "../types.ts";

interface IssueCollector {
	add: (path: string, message: string) => void;
	issues: AskValidationIssue[];
}

interface ValidationOptions {
	presentSingleAsMulti?: boolean;
}

export function normalizeQuestions(
	params: AskParams,
	options: ValidationOptions = {}
): AskQuestion[] {
	const issues = collectValidationIssues(params);
	if (issues.length > 0) {
		throw new Error(issues[0]?.message ?? "Invalid ask_user payload");
	}
	return params.questions.map((question, index) =>
		normalizeQuestion(question, index, options)
	);
}

export function collectValidationIssues(
	params: AskParams
): AskValidationIssue[] {
	const collector = createIssueCollector();
	validateQuestions(params.questions, collector);
	return collector.issues;
}

/** Fill derivable labels and convert forms saved before question context existed. */
export function prepareAskParams(input: unknown): unknown {
	if (!(isRecord(input) && Array.isArray(input.questions))) {
		return input;
	}
	return {
		...input,
		questions: input.questions.map((question) => {
			if (!(isRecord(question) && Array.isArray(question.options))) {
				return question;
			}
			return migrateLegacyPreview({
				...question,
				options: question.options.map(prepareOption),
			});
		}),
	};
}

/** Older forms showed per-option previews; their text becomes the question context. */
function migrateLegacyPreview(
	question: Record<string, unknown> & { options: unknown[] }
): Record<string, unknown> {
	const previews = question.options.flatMap((option) => {
		if (!isRecord(option)) {
			return [];
		}
		const text = legacyPreviewText(option);
		return text ? [{ label: option.label, text }] : [];
	});
	const options = question.options.map((option) => {
		if (!isRecord(option)) {
			return option;
		}
		const { preview: _preview, previewFile: _previewFile, ...rest } = option;
		return rest;
	});
	const context =
		typeof question.context === "string" && question.context.trim()
			? question.context
			: legacyContext(previews);
	return {
		...question,
		...(question.type === "preview" ? { type: "single" } : {}),
		...(context ? { context } : {}),
		options,
	};
}

function legacyPreviewText(
	option: Record<string, unknown>
): string | undefined {
	if (typeof option.preview === "string" && option.preview.trim()) {
		return option.preview;
	}
	const file =
		typeof option.previewFile === "string" ? option.previewFile.trim() : "";
	return isAbsolute(file) ? file : undefined;
}

function legacyContext(
	previews: Array<{ label: unknown; text: string }>
): string | undefined {
	if (previews.length <= 1) {
		return previews[0]?.text;
	}
	return previews
		.map(
			({ label, text }) => `${typeof label === "string" ? label : ""}\n${text}`
		)
		.join("\n\n");
}

function prepareOption(input: unknown): unknown {
	if (!isRecord(input)) {
		return input;
	}
	if (
		input.label !== undefined &&
		!(typeof input.label === "string" && !input.label.trim())
	) {
		return input;
	}
	if (typeof input.value !== "string") {
		return input;
	}
	const words = input.value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	if (!words) {
		return input;
	}
	return {
		...input,
		label: words.charAt(0).toUpperCase() + words.slice(1),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeQuestion(
	question: AskQuestionInput,
	index: number,
	options: ValidationOptions = {}
): AskQuestion {
	const requestedType = normalizeQuestionType(question.type);
	const presentedType =
		options.presentSingleAsMulti && requestedType === "single"
			? "multi"
			: requestedType;
	return {
		id: question.id.trim(),
		label: question.label?.trim() || `Q${index + 1}`,
		prompt: question.prompt.trim(),
		...(question.context?.trim() ? { context: question.context } : {}),
		type: presentedType,
		...(presentedType === requestedType
			? {}
			: { requestedType, presentedType }),
		options: question.options.map(normalizeOption),
	};
}

function normalizeOption(option: AskOption): AskOption {
	return {
		value: option.value.trim(),
		label: option.label.trim(),
		description: option.description?.trim() || undefined,
		...(option.recommended === undefined
			? {}
			: { recommended: option.recommended }),
	};
}

function validateQuestions(
	questions: AskParams["questions"],
	collector: IssueCollector
) {
	if (questions.length === 0) {
		collector.add("questions", "At least one question is required");
		return;
	}

	const questionIds = new Set<string>();
	for (const [questionIndex, question] of questions.entries()) {
		validateQuestion(question, questionIndex, questionIds, collector);
	}
}

function validateQuestion(
	question: AskQuestionInput,
	questionIndex: number,
	questionIds: Set<string>,
	collector: IssueCollector
) {
	const questionNumber = questionIndex + 1;
	const questionPath = `questions[${questionIndex}]`;
	const questionId = question.id?.trim();
	validateQuestionType(
		question.type,
		questionNumber,
		collector,
		`${questionPath}.type`
	);
	assertRequired(
		questionId,
		collector,
		`${questionPath}.id`,
		`Question ${questionNumber}: id is required`
	);
	assertUnique(
		questionIds,
		questionId,
		collector,
		`${questionPath}.id`,
		`Question ${questionNumber}: duplicate question id "${questionId}"`
	);
	assertRequired(
		question.prompt?.trim(),
		collector,
		`${questionPath}.prompt`,
		`Question ${questionNumber}: prompt is required`
	);
	assertHasItems(
		question.options,
		collector,
		`${questionPath}.options`,
		`Question ${questionNumber}: at least one option is required`
	);

	const optionValues = new Set<string>();
	for (const [optionIndex, option] of question.options.entries()) {
		validateOption(
			option,
			optionIndex,
			optionValues,
			questionNumber,
			collector,
			`${questionPath}.options[${optionIndex}]`
		);
	}
}

function validateOption(
	option: AskOption,
	optionIndex: number,
	optionValues: Set<string>,
	questionNumber: number,
	collector: IssueCollector,
	optionPath: string
) {
	const optionNumber = optionIndex + 1;
	const prefix = `Question ${questionNumber}, option ${optionNumber}`;
	const optionValue = option.value?.trim();

	assertRequired(
		optionValue,
		collector,
		`${optionPath}.value`,
		`${prefix}: value is required`
	);
	assertUnique(
		optionValues,
		optionValue,
		collector,
		`${optionPath}.value`,
		`${prefix}: duplicate option value "${optionValue}"`
	);
	assertRequired(
		option.label?.trim(),
		collector,
		`${optionPath}.label`,
		`${prefix}: label is required`
	);
}

function normalizeQuestionType(
	value: AskQuestionInput["type"]
): AskQuestion["type"] {
	return value === "multi" ? "multi" : "single";
}

function validateQuestionType(
	value: AskQuestionInput["type"],
	questionNumber: number,
	collector: IssueCollector,
	path: string
) {
	if (value !== undefined && value !== "single" && value !== "multi") {
		collector.add(
			path,
			`Question ${questionNumber}: invalid type ${JSON.stringify(value)}; expected "single" or "multi"`
		);
	}
}

function assertHasItems(
	items: unknown[],
	collector: IssueCollector,
	path: string,
	message: string
) {
	if (items.length === 0) {
		collector.add(path, message);
	}
}

function assertRequired(
	value: string | undefined,
	collector: IssueCollector,
	path: string,
	message: string
) {
	if (!value) {
		collector.add(path, message);
	}
}

function assertUnique(
	seen: Set<string>,
	value: string | undefined,
	collector: IssueCollector,
	path: string,
	message: string
) {
	if (!value) {
		return;
	}
	if (seen.has(value)) {
		collector.add(path, message);
		return;
	}
	seen.add(value);
}

function createIssueCollector(): IssueCollector {
	const issues: AskValidationIssue[] = [];
	return {
		issues,
		add(path, message) {
			issues.push({ path, message });
		},
	};
}
