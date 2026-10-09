import type { AskImage, AskState, AskStateAnswer } from "../types.ts";
import { hasCustomAnswer, isAnswerEmpty } from "./answers.ts";
import {
	getAnswer,
	getCurrentOption,
	getCurrentQuestion,
	getOptionNote,
	getQuestionNote,
	isSubmitTab,
} from "./selectors.ts";
import {
	enterInputMode,
	saveCustomAnswer,
	saveNote,
	submitCustomAnswer,
} from "./transitions.ts";
import { isEditingView } from "./view.ts";

/** Read the images owned by the currently open editor. */
export function getEditorImages(state: AskState): AskImage[] {
	const view = state.view;
	if (view.kind !== "input" && view.kind !== "note") {
		return [];
	}
	const answer = state.answers[view.questionId];
	if (view.kind === "input") {
		return answer?.customImages ?? [];
	}
	return (
		(view.optionValue
			? answer?.optionNoteImages?.[view.optionValue]
			: answer?.noteImages) ?? []
	);
}

/** Replace images only in the active editor; text and other editors are untouched. */
export function setEditorImages(state: AskState, images: AskImage[]): AskState {
	const view = state.view;
	if (view.kind !== "input" && view.kind !== "note") {
		return state;
	}
	const answer = updateEditorImages(
		state.answers[view.questionId] ?? { selected: [] },
		view,
		images
	);
	const answers = { ...state.answers };
	if (isAnswerEmpty(answer)) {
		delete answers[view.questionId];
	} else {
		answers[view.questionId] = answer;
	}
	return { ...state, answers };
}
function updateEditorImages(
	saved: AskStateAnswer,
	view: Extract<AskState["view"], { kind: "input" | "note" }>,
	images: AskImage[]
): AskStateAnswer {
	const answer = { ...saved };
	if (view.kind === "input") {
		answer.customImages = images.length ? images : undefined;
	} else if (view.optionValue) {
		const notes = { ...answer.optionNoteImages };
		if (images.length) {
			notes[view.optionValue] = images;
		} else {
			delete notes[view.optionValue];
		}
		answer.optionNoteImages = Object.keys(notes).length ? notes : undefined;
	} else {
		answer.noteImages = images.length ? images : undefined;
	}
	return answer;
}
export function getEditorDraft(state: AskState): string {
	if (state.view.kind === "input") {
		return getAnswer(state, state.view.questionId)?.customText ?? "";
	}
	if (state.view.kind === "note") {
		if (state.view.optionValue) {
			return (
				getOptionNote(state, state.view.questionId, state.view.optionValue) ??
				""
			);
		}
		return getQuestionNote(state, state.view.questionId) ?? "";
	}
	return "";
}

export function saveEditorDraft(state: AskState, text: string): AskState {
	if (state.view.kind === "input") {
		return saveCustomAnswer(state, text);
	}
	if (state.view.kind === "note") {
		return saveNote(state, text);
	}
	return state;
}

export function submitEditorDraft(state: AskState, text: string): AskState {
	if (state.view.kind === "input") {
		return submitCustomAnswer(state, text);
	}
	if (state.view.kind === "note") {
		return saveNote(state, text);
	}
	return state;
}

export function syncStateToSelection(state: AskState): AskState {
	if (isEditingView(state) || isSubmitTab(state)) {
		return state;
	}

	const question = getCurrentQuestion(state);
	const option = getCurrentOption(state);
	if (!(question && option?.isCustomOption)) {
		return state;
	}

	if (hasCustomAnswer(getAnswer(state, question.id))) {
		return state;
	}

	return enterInputMode(state, question.id);
}
