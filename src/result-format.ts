import { ELABORATED_SUMMARY } from "./constants/text.ts";
import { answerDisplayText, withImageMarker } from "./images.ts";
import { isCustomOnlyAnswer } from "./state/answers.ts";
import type { AskResult } from "./types.ts";

export function formatResultLines(
	result: AskResult,
	options: { mode: "summary" | "render" }
): string[] {
	const lines: string[] = [];

	let hasPresentationOverride = false;

	for (const question of result.questions) {
		const answer = result.answers[question.id];
		if (!answer) {
			lines.push(formatUnansweredLine(question.label, options.mode));
			continue;
		}

		const answerLine = formatAnswerLine(question.label, answer, options.mode);
		lines.push(
			answerLine ?? formatUnansweredLine(question.label, options.mode)
		);

		if (hasPresentedTypeOverride(question.type, question.presentedType)) {
			hasPresentationOverride = true;
		}

		const questionNoteLine = formatQuestionNoteLine(
			question.label,
			withImageMarker(answer.note, answer.noteImages) || undefined,
			options.mode
		);
		if (questionNoteLine) {
			lines.push(questionNoteLine);
		}

		lines.push(...formatOptionNoteLines(question.label, answer, options.mode));
	}

	if (hasPresentationOverride) {
		lines.push(formatPresentationNoteLine(options.mode));
	}

	return lines;
}

function formatUnansweredLine(
	questionLabel: string,
	mode: "summary" | "render"
): string {
	return mode === "summary"
		? `${questionLabel}: (no answer)`
		: `? ${questionLabel}: (no answer)`;
}

function formatAnswerLine(
	questionLabel: string,
	answer: AskResult["answers"][string],
	mode: "summary" | "render"
): string | undefined {
	const answerText = answerDisplayText(answer);
	if (!answerText) {
		return;
	}
	if (mode === "summary") {
		return `${questionLabel}: ${answerText}`;
	}
	if (isCustomOnlyAnswer(answer)) {
		return `✓ ${questionLabel}: (wrote) ${answerText}`;
	}
	return `✓ ${questionLabel}: ${answerText}`;
}

function hasPresentedTypeOverride(
	type: string,
	presentedType: string | undefined
): boolean {
	return !!presentedType && presentedType !== type;
}

function formatPresentationNoteLine(mode: "summary" | "render"): string {
	const text =
		"Note: Some questions were presented as multi-select by user preference.";
	return mode === "summary" ? text : `  ${text}`;
}

function formatQuestionNoteLine(
	questionLabel: string,
	note: string | undefined,
	mode: "summary" | "render"
): string | undefined {
	if (!note) {
		return;
	}
	return mode === "summary"
		? `${questionLabel} note: ${note}`
		: `  note: ${note}`;
}

export function formatElaborationLines(
	result: AskResult,
	_options: { mode: "summary" | "render" }
): string[] {
	const items = result.elaboration?.items ?? [];
	const lines = items.map((item) => {
		const answerContext = formatElaborationAnswerContext(item.answer);
		const note = withImageMarker(item.note, item.images);
		if (item.target.kind === "question") {
			return `User asked to elaborate on question ${quote(item.question.prompt)}${answerContext} with note ${quote(note)}`;
		}
		if (!("option" in item)) {
			return `User asked to elaborate on question ${quote(item.question.prompt)}${answerContext} with note ${quote(note)}`;
		}
		return `User asked to elaborate on question ${quote(item.question.prompt)} option ${quote(item.option.label)}${answerContext} with note ${quote(note)}`;
	});

	if (lines.length > 0) {
		return lines;
	}

	const answerLines = result.questions
		.map((question) => {
			const answer = result.answers[question.id];
			return answer && answerDisplayText(answer)
				? `User asked to elaborate on question ${quote(question.prompt)} after current answer ${quote(answerDisplayText(answer))}`
				: undefined;
		})
		.filter((line): line is string => Boolean(line));

	return answerLines.length > 0 ? answerLines : [ELABORATED_SUMMARY];
}

function formatElaborationAnswerContext(
	answer: AskResult["answers"][string] | undefined
): string {
	const text = answer ? answerDisplayText(answer) : "";
	if (!text) {
		return "";
	}
	return ` after current answer ${quote(text)}`;
}

function quote(value: string): string {
	return JSON.stringify(value);
}

function formatOptionNoteLines(
	questionLabel: string,
	answer: AskResult["answers"][string],
	mode: "summary" | "render"
): string[] {
	const lines: string[] = [];
	for (let index = 0; index < answer.values.length; index++) {
		const value = answer.values[index];
		const label = answer.labels[index] ?? value;
		const note = withImageMarker(
			answer.optionNotes?.[value],
			answer.optionNoteImages?.[value]
		);
		if (!note) {
			continue;
		}
		lines.push(
			mode === "summary"
				? `${questionLabel} / ${label} note: ${note}`
				: `  ${label} note: ${note}`
		);
	}
	return lines;
}
