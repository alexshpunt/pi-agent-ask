import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { SUBMIT_CHOICES } from "./constants/text.ts";
import { AnswerSchema } from "./result-schema.ts";
import { AskParamsSchema, AskQuestionSchema } from "./schema.ts";
import { hasCustomAnswer } from "./state/answers.ts";
import { normalizeQuestions } from "./state/normalize.ts";
import { getResultQuestions } from "./state/skip.ts";
import type {
	AskParams,
	AskQuestion,
	AskState,
	AskStateAnswer,
} from "./types.ts";

export interface AskDraft {
	editorText: string;
	state: AskState;
}

const QuestionTypeSchema = StringEnum(["single", "multi"] as const);
const DraftQuestionSchema = Type.Object({
	...AskQuestionSchema.properties,
	label: Type.String(),
	type: QuestionTypeSchema,
	requestedType: Type.Optional(QuestionTypeSchema),
	presentedType: Type.Optional(QuestionTypeSchema),
});

const DraftAnswerSchema = Type.Object({
	customImages: AnswerSchema.properties.customImages,
	customSelected: Type.Optional(Type.Boolean()),
	customText: AnswerSchema.properties.customText,
	note: AnswerSchema.properties.note,
	noteImages: AnswerSchema.properties.noteImages,
	optionNotes: AnswerSchema.properties.optionNotes,
	optionNoteImages: AnswerSchema.properties.optionNoteImages,
	selected: Type.Array(
		Type.Object({
			index: Type.Integer({ minimum: 1 }),
			label: Type.String(),
			value: Type.String(),
		})
	),
});

/** Full draft shape; request ownership and navigation are checked when restoring. */
export const AskDraftSchema = Type.Object({
	editorText: Type.String(),
	state: Type.Object({
		activeOptionIndex: Type.Integer({ minimum: 0 }),
		activeSubmitActionIndex: Type.Integer({
			minimum: 0,
			maximum: SUBMIT_CHOICES.length - 1,
		}),
		activeTabIndex: Type.Integer({ minimum: 0 }),
		answers: Type.Record(Type.String(), DraftAnswerSchema),
		cancelled: Type.Literal(false),
		completed: Type.Literal(false),
		questions: Type.Array(DraftQuestionSchema),
		skippedQuestions: Type.Optional(
			Type.Array(
				Type.Object({
					index: Type.Integer({ minimum: 0 }),
					question: DraftQuestionSchema,
				})
			)
		),
		title: Type.Optional(Type.String()),
		view: Type.Union([
			Type.Object(
				{ kind: Type.Literal("navigate") },
				{ additionalProperties: false }
			),
			Type.Object(
				{ kind: Type.Literal("submit") },
				{ additionalProperties: false }
			),
			Type.Object(
				{ kind: Type.Literal("input"), questionId: Type.String() },
				{ additionalProperties: false }
			),
			Type.Object(
				{
					kind: Type.Literal("note"),
					questionId: Type.String(),
					optionValue: Type.Optional(Type.String()),
				},
				{ additionalProperties: false }
			),
		]),
	}),
});

/** Restore without committing raw editor text, navigating, or changing presentation. */
export function restoreAskDraft(
	value: unknown,
	params: AskParams
): AskDraft | undefined {
	if (
		!(
			Value.Check(AskDraftSchema, value) && Value.Check(AskParamsSchema, params)
		)
	) {
		return;
	}
	let questions: AskQuestion[];
	try {
		questions = normalizeQuestions(params);
	} catch {
		return;
	}
	if (
		value.state.title !== (params.title?.trim() || undefined) ||
		!hasValidQuestions(value.state, questions) ||
		!hasValidNavigation(value.state) ||
		!hasValidAnswers(value.state)
	) {
		return;
	}
	return value;
}

function hasValidQuestions(state: AskState, originals: AskQuestion[]): boolean {
	const skippedPositions = new Set<number>();
	for (const { index, question } of state.skippedQuestions ?? []) {
		if (skippedPositions.has(index) || originals[index]?.id !== question.id) {
			return false;
		}
		skippedPositions.add(index);
	}
	const questions = getResultQuestions(state);
	return (
		questions.length === originals.length &&
		questions.every((question, index) =>
			matchesQuestion(question, originals[index])
		)
	);
}

function matchesQuestion(
	question: AskQuestion,
	original: AskQuestion
): boolean {
	return (
		question.id === original.id &&
		question.label === original.label &&
		question.prompt === original.prompt &&
		question.context === original.context &&
		(question.requestedType ?? question.type) === original.type &&
		question.presentedType ===
			(question.type === original.type ? undefined : question.type) &&
		question.options.length === original.options.length &&
		question.options.every((option, index) => {
			const expected = original.options[index];
			return (
				option.value === expected.value &&
				option.label === expected.label &&
				option.description === expected.description &&
				option.recommended === expected.recommended
			);
		})
	);
}

function hasValidNavigation(state: AskState): boolean {
	if (state.activeTabIndex > state.questions.length) {
		return false;
	}
	const question = state.questions[state.activeTabIndex];
	if (state.activeOptionIndex > (question?.options.length ?? 0)) {
		return false;
	}
	const view = state.view;
	if (view.kind === "submit") {
		return !question;
	}
	if (view.kind === "navigate") {
		return !!question;
	}
	if (!question || view.questionId !== question.id) {
		return false;
	}
	return (
		view.kind !== "note" ||
		view.optionValue === undefined ||
		question.options.some((option) => option.value === view.optionValue)
	);
}

function hasValidAnswers(state: AskState): boolean {
	const questions = new Map(
		state.questions.map((question) => [question.id, question])
	);
	for (const [id, answer] of Object.entries(state.answers)) {
		const question = questions.get(id);
		if (!(question && matchesAnswer(answer, question))) {
			return false;
		}
	}
	return true;
}

function matchesAnswer(answer: AskStateAnswer, question: AskQuestion): boolean {
	if (
		question.type !== "multi" &&
		(answer.selected.length > 1 ||
			(answer.selected.length > 0 &&
				answer.customSelected &&
				hasCustomAnswer(answer)))
	) {
		return false;
	}
	const selected = new Set<string>();
	for (const selection of answer.selected) {
		const option = question.options[selection.index - 1];
		if (
			!option ||
			selected.has(selection.value) ||
			selection.value !== option.value ||
			selection.label !== option.label
		) {
			return false;
		}
		selected.add(selection.value);
	}
	return [
		...Object.keys(answer.optionNotes ?? {}),
		...Object.keys(answer.optionNoteImages ?? {}),
	].every((value) => question.options.some((option) => option.value === value));
}
