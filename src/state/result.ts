import { CANCELLED_SUMMARY, SUBMITTED_SUMMARY } from "../constants/text.ts";
import { formatResultLines } from "../result-format.ts";
import type { AskResult, AskState, AskStateAnswer } from "../types.ts";
import {
	getExtraOptionNotes,
	isAnswerEmpty,
	isResultAnswerCommitted,
	isResultAnswerEmpty,
	serializeAnswer,
} from "./answers.ts";
import { getResultQuestions } from "./skip.ts";

export type ReviewAnswer = AskResult["answers"][string] & {
	extraOptionNotes?: Array<{
		label: string;
		note: string;
	}>;
};

export function toAskResult(state: AskState): AskResult {
	const questions = getResultQuestions(state);
	const skipped = new Set(
		state.skippedQuestions?.map(({ question }) => question.id)
	);
	const skippedQuestionIds = questions
		.filter((question) => skipped.has(question.id))
		.map((question) => question.id);
	const answers = Object.fromEntries(
		Object.entries(state.answers)
			.filter(([questionId]) => !skipped.has(questionId))
			.map(([questionId, answer]) => {
				const serialized = serializeAnswer(answer);
				if (state.cancelled) {
					serialized.customImages = undefined;
					serialized.noteImages = undefined;
					serialized.optionNoteImages = undefined;
				}
				return [questionId, serialized] as const;
			})
			.filter(([, answer]) => !isResultAnswerEmpty(answer))
	);

	return {
		title: state.title,
		cancelled: state.cancelled,
		questions: questions.map((question) => ({
			id: question.id,
			label: question.label,
			prompt: question.prompt,
			type: question.requestedType ?? question.type,
			...(question.presentedType &&
			question.presentedType !== question.requestedType
				? { presentedType: question.presentedType }
				: {}),
		})),
		answers,
		...(skippedQuestionIds.length ? { skippedQuestionIds } : {}),
	};
}

export function summarizeResult(result: AskResult): string {
	if (result.cancelled) {
		return CANCELLED_SUMMARY;
	}
	const lines = formatResultLines(result, { mode: "summary" });
	return lines.join("\n") || SUBMITTED_SUMMARY;
}

export function hasAnswerContent(state: AskState, questionId: string): boolean {
	const answer = state.answers[questionId];
	return !!answer && !isAnswerEmpty(answer);
}

export function toReviewAnswer(
	question: AskState["questions"][number],
	answer: AskStateAnswer | undefined
): ReviewAnswer | undefined {
	if (!answer) {
		return;
	}

	const serialized = serializeAnswer(answer);
	const hasCommittedAnswer = isResultAnswerCommitted(serialized);

	const extraOptionNotes = getExtraOptionNotes({
		answer,
		questionOptions: question.options,
		selectedValues: serialized.values,
	});
	if (
		!(hasCommittedAnswer || serialized.note || serialized.noteImages?.length) &&
		extraOptionNotes.length === 0
	) {
		return;
	}

	return {
		...serialized,
		extraOptionNotes:
			extraOptionNotes.length > 0 ? extraOptionNotes : undefined,
	};
}

export function shouldRenderAnswersIndividually(answer: ReviewAnswer): boolean {
	if (!answer.labels.length) {
		return false;
	}

	return (
		answer.labels.length > 1 ||
		Boolean(answer.optionNotes && Object.keys(answer.optionNotes).length > 0) ||
		Boolean(
			answer.optionNoteImages && Object.keys(answer.optionNoteImages).length > 0
		)
	);
}
