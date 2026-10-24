import { answerDisplayText, withImageMarker } from "./images.ts";
import { isCustomOnlyAnswer } from "./state/answers.ts";
import type { AskResult } from "./types.ts";

export function formatResultLines(
	result: AskResult,
	options: { mode: "summary" | "render" }
): string[] {
	const lines: string[] = [];

	let hasPresentationOverride = false;

	const skipped = new Set(result.skippedQuestionIds);
	for (const question of result.questions) {
		if (skipped.has(question.id)) {
			lines.push(formatSkippedLine(question.label, options.mode));
			continue;
		}
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

function formatSkippedLine(
	questionLabel: string,
	mode: "summary" | "render"
): string {
	return mode === "summary"
		? `${questionLabel}: (skipped)`
		: `? ${questionLabel}: (skipped)`;
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

function formatOptionNoteLines(
	questionLabel: string,
	answer: AskResult["answers"][string],
	mode: "summary" | "render"
): string[] {
	const lines: string[] = [];
	const notedValues = new Set([
		...answer.values,
		...Object.keys(answer.optionNotes ?? {}),
		...Object.keys(answer.optionNoteImages ?? {}),
	]);
	for (const value of notedValues) {
		const index = answer.values.indexOf(value);
		const label =
			index >= 0 ? (answer.labels[index] ?? value) : `${value} (not selected)`;
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
