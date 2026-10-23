import type { AskQuestion, AskState } from "../types.ts";
import { navigateView, submitView } from "./view.ts";

/** Remove one question from active navigation without submitting the questionnaire. */
export function skipCurrentQuestion(state: AskState): AskState {
	const question = state.questions[state.activeTabIndex];
	if (state.completed || state.cancelled || !question) {
		return state;
	}
	const index = getResultQuestions(state).findIndex(
		(candidate) => candidate.id === question.id
	);
	const questions = state.questions.filter(
		(candidate) => candidate.id !== question.id
	);
	const answers = { ...state.answers };
	delete answers[question.id];
	const activeTabIndex = Math.min(state.activeTabIndex, questions.length);
	return {
		...state,
		questions,
		answers,
		skippedQuestions: [...(state.skippedQuestions ?? []), { index, question }],
		activeTabIndex,
		activeOptionIndex: 0,
		activeSubmitActionIndex: 0,
		view: activeTabIndex >= questions.length ? submitView() : navigateView(),
	};
}

/** Restore original order while keeping the live presentation of remaining questions. */
export function getResultQuestions(state: AskState): AskQuestion[] {
	const questions = [...state.questions];
	for (const { index, question } of [...(state.skippedQuestions ?? [])].sort(
		(left, right) => left.index - right.index
	)) {
		questions.splice(index, 0, question);
	}
	return questions;
}
