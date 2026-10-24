import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { renderResultText } from "../src/result.ts";
import { AskResultSchema } from "../src/result-schema.ts";
import { createInitialState } from "../src/state/create.ts";
import { summarizeResult, toAskResult } from "../src/state/result.ts";
import { skipCurrentQuestion } from "../src/state/skip.ts";
import { confirmCurrentSelection, moveTab } from "../src/state/transitions.ts";
import type { AskState } from "../src/types.ts";

function createQuestions() {
	return createInitialState({
		questions: ["first", "second", "third"].map((id) => ({
			id,
			label: id,
			prompt: `Choose ${id}?`,
			options: [{ value: "yes", label: "Yes" }],
		})),
	});
}

test("skipping removes only the current question and its answer data", () => {
	const original: AskState = {
		...moveTab(createQuestions(), 1),
		answers: {
			first: { selected: [{ index: 1, label: "Yes", value: "yes" }] },
			second: {
				selected: [{ index: 1, label: "Yes", value: "yes" }],
				customText: "discarded answer",
				note: "discarded note",
				optionNotes: { yes: "discarded option note" },
				customImages: [{ id: "image", mimeType: "image/png", data: "secret" }],
				noteImages: [{ id: "note", mimeType: "image/png", data: "secret" }],
				optionNoteImages: {
					yes: [{ id: "option", mimeType: "image/png", data: "secret" }],
				},
			},
			third: { selected: [], customText: "keep this draft", note: "keep note" },
		},
	};
	const next = skipCurrentQuestion(original);

	assert.deepEqual(
		next.questions.map((question) => question.id),
		["first", "third"]
	);
	assert.equal(next.questions[next.activeTabIndex]?.id, "third");
	assert.equal(next.answers.second, undefined);
	assert.equal(next.answers.first, original.answers.first);
	assert.equal(next.answers.third, original.answers.third);
	assert.equal(next.completed, false);
	assert.equal(next.cancelled, false);
	assert.equal(original.questions.length, 3);
	assert.equal(original.answers.second?.note, "discarded note");
	assert.equal(JSON.stringify(toAskResult(next)).includes("secret"), false);
});

test("skipping the last question reaches Review without submitting or cancelling", () => {
	const state = moveTab(moveTab(createQuestions(), 1), 1);
	const next = skipCurrentQuestion(state);

	assert.equal(next.activeTabIndex, next.questions.length);
	assert.deepEqual(next.view, { kind: "submit" });
	assert.equal(next.activeSubmitActionIndex, 0);
	assert.equal(next.completed, false);
	assert.equal(next.cancelled, false);
	assert.equal(skipCurrentQuestion(next), next);
});

test("skipping every question still requires an explicit completion", () => {
	let state = createQuestions();
	state = skipCurrentQuestion(state);
	state = skipCurrentQuestion(state);
	state = skipCurrentQuestion(state);

	assert.deepEqual(state.questions, []);
	assert.deepEqual(state.view, { kind: "submit" });
	assert.equal(state.completed, false);
	assert.equal(state.cancelled, false);

	state = confirmCurrentSelection(state);
	const result = toAskResult(state);
	assert.equal(state.completed, true);
	assert.equal(result.cancelled, false);
	assert.deepEqual(result.answers, {});
	assert.deepEqual(result.skippedQuestionIds, ["first", "second", "third"]);
	assert.equal(
		summarizeResult(result),
		"first: (skipped)\nsecond: (skipped)\nthird: (skipped)"
	);
	assert.equal(
		renderResultText(result),
		"? first: (skipped)\n? second: (skipped)\n? third: (skipped)"
	);
});

test("recovered skip state serializes original question order and presentations", () => {
	let state = createQuestions();
	state = skipCurrentQuestion(moveTab(state, 1));
	state = skipCurrentQuestion(moveTab(state, -1));
	state = {
		...state,
		questions: state.questions.map((question) => ({
			...question,
			type: "multi",
			requestedType: "single",
			presentedType: "multi",
		})),
	};
	const recovered = JSON.parse(JSON.stringify(state)) as AskState;
	const result = toAskResult(recovered);

	assert.deepEqual(
		result.questions.map((question) => question.id),
		["first", "second", "third"]
	);
	assert.deepEqual(result.skippedQuestionIds, ["first", "second"]);
	assert.equal(result.questions[2]?.type, "single");
	assert.equal(result.questions[2]?.presentedType, "multi");
	assert.equal(Value.Check(AskResultSchema, result), true);
});

test("skipped questions do not leak stale answers after recovery", () => {
	let state = skipCurrentQuestion(createQuestions());
	state = {
		...state,
		answers: {
			first: {
				selected: [],
				note: "stale secret note",
				customImages: [{ id: "stale", mimeType: "image/png", data: "secret" }],
			},
			second: { selected: [], note: "Explain the tradeoff" },
		},
	};
	const result = toAskResult(state);

	assert.equal(result.answers.first, undefined);
	assert.equal(result.answers.second?.note, "Explain the tradeoff");
	assert.equal(JSON.stringify(result).includes("secret"), false);
	assert(summarizeResult(result).includes("first: (skipped)"));
	assert(renderResultText(result).includes("? first: (skipped)"));
	assert.equal(Value.Check(AskResultSchema, result), true);
});

test("ordinary results have no skip metadata and completed flows cannot change", () => {
	const state = createQuestions();
	assert.equal(toAskResult(state).skippedQuestionIds, undefined);
	const completed = { ...state, completed: true };
	assert.equal(skipCurrentQuestion(completed), completed);
});
