import { visibleWidth } from "@earendil-works/pi-tui";
import { SUBMIT_CHOICES } from "../../constants/text.ts";
import { UI_DIMENSIONS } from "../../constants/ui.ts";
import {
	answerDisplayText,
	imageMarker,
	withImageMarker,
} from "../../images.ts";
import { isCustomOnlyAnswer } from "../../state/answers.ts";
import {
	type ReviewAnswer,
	shouldRenderAnswersIndividually,
	toReviewAnswer,
} from "../../state/result.ts";
import type { AskState } from "../../types.ts";

export interface ReviewSelectionModel {
	label: string;
	note?: string;
}

export interface ReviewQuestionModel {
	answerText?: string;
	extraOptionNotes?: Array<{ label: string; note: string }>;
	isCustomOnly?: boolean;
	label: string;
	note?: string;
	selections?: ReviewSelectionModel[];
	unanswered: boolean;
}

export interface ReviewScreenModel {
	actionColumnWidth: number;
	actions: Array<{ label: string; selected: boolean }>;
	layout: "stacked" | "wide";
	questions: ReviewQuestionModel[];
}

export function buildReviewScreenModel(
	state: AskState,
	width: number
): ReviewScreenModel {
	const showAllNotes = state.activeSubmitActionIndex === 1;
	const actionColumnWidth = getSubmitActionColumnWidth();
	return {
		actionColumnWidth,
		actions: SUBMIT_CHOICES.map((label, index) => ({
			label,
			selected: index === state.activeSubmitActionIndex,
		})),
		layout: shouldUseWideSubmitLayout(width, actionColumnWidth)
			? "wide"
			: "stacked",
		questions: state.questions.map((question) =>
			toReviewQuestionModel(
				question.label,
				toReviewAnswer(question, state.answers[question.id], showAllNotes)
			)
		),
	};
}

/** Map serialized answers to the shared review presentation. */
export function toReviewQuestionModel(
	label: string,
	answer: ReviewAnswer | undefined
): ReviewQuestionModel {
	if (!answer) {
		return { label, unanswered: true };
	}

	const selections = answer.labels.map((selectionLabel, index) => ({
		label:
			index === answer.labels.length - 1 && answer.customText
				? withImageMarker(selectionLabel, answer.customImages)
				: selectionLabel,
		note:
			withImageMarker(
				answer.optionNotes?.[answer.values[index] ?? selectionLabel],
				answer.optionNoteImages?.[answer.values[index] ?? selectionLabel]
			) || undefined,
	}));
	if (answer.customImages?.length && !answer.customText) {
		selections.push({
			label: imageMarker(answer.customImages),
			note: undefined,
		});
	}
	return {
		answerText: shouldRenderAnswersIndividually(answer)
			? undefined
			: answerDisplayText(answer),
		extraOptionNotes: answer.extraOptionNotes,
		isCustomOnly: isCustomOnlyAnswer(answer),
		label,
		note: withImageMarker(answer.note, answer.noteImages) || answer.note,
		selections: shouldRenderAnswersIndividually(answer)
			? selections
			: undefined,
		unanswered: false,
	};
}

function getSubmitActionColumnWidth(): number {
	return Math.max(
		...SUBMIT_CHOICES.map((choice, index) =>
			visibleWidth(`❯ ${index + 1}. ${choice}`)
		)
	);
}

function shouldUseWideSubmitLayout(
	width: number,
	actionColumnWidth: number
): boolean {
	return (
		width >= UI_DIMENSIONS.submitWideMinWidth &&
		width - actionColumnWidth - 2 >= UI_DIMENSIONS.submitMinReviewWidth
	);
}
