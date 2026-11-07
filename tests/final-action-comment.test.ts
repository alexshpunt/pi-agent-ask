import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { restoreAskDraft } from "../src/ask-draft.ts";
import { formatQueuedAnswer } from "../src/background-answer.ts";
import { renderResultText } from "../src/result.ts";
import {
	AskOutputSchema,
	AskResultSchema,
	toAskOutput,
} from "../src/result-schema.ts";
import { createInitialState } from "../src/state/create.ts";
import { getEditorDraft, submitEditorDraft } from "../src/state/editor.ts";
import { toAskResult } from "../src/state/result.ts";
import {
	confirmCurrentSelection,
	enterSubmitNoteMode,
	moveOption,
} from "../src/state/transitions.ts";
import type { AskState } from "../src/types.ts";

const params = {
	questions: [
		{ id: "q", prompt: "Question?", options: [{ value: "a", label: "A" }] },
	],
};

test("final actions keep separate optional comments and return the chosen one", () => {
	let state: AskState = {
		...createInitialState(params),
		activeTabIndex: 1,
		view: { kind: "submit" as const },
	};
	state = submitEditorDraft(enterSubmitNoteMode(state), "submit comment");
	state = moveOption(state, 1);
	state = submitEditorDraft(enterSubmitNoteMode(state), "cancel comment");
	assert.equal(getEditorDraft(enterSubmitNoteMode(state)), "cancel comment");
	const cancelled = toAskResult(confirmCurrentSelection(state));
	assert.equal(cancelled.cancelled, true);
	assert.equal(cancelled.comment, "cancel comment");
	assert.equal(toAskOutput(cancelled).comment, "cancel comment");
	assert.ok(Value.Check(AskResultSchema, cancelled));
	assert.ok(Value.Check(AskOutputSchema, toAskOutput(cancelled)));
	assert.ok(
		formatQueuedAnswer({ requestId: "request", result: cancelled }).includes(
			"cancel comment"
		)
	);
	assert.ok(renderResultText(cancelled).includes("cancel comment"));
	state = moveOption(state, -1);
	const submitted = toAskResult(confirmCurrentSelection(state));
	assert.equal(submitted.cancelled, false);
	assert.equal(submitted.comment, "submit comment");
	assert.ok(renderResultText(submitted).includes("submit comment"));
	state = submitEditorDraft(enterSubmitNoteMode(state), "   ");
	assert.equal(toAskResult(confirmCurrentSelection(state)).comment, undefined);
});

test("an open final comment survives draft recovery", () => {
	let state: AskState = {
		...createInitialState(params),
		activeTabIndex: 1,
		view: { kind: "submit" as const },
	};
	state = enterSubmitNoteMode(state);
	const restored = restoreAskDraft({ state, editorText: "unfinished" }, params);
	assert.equal(restored?.editorText, "unfinished");
	assert.equal(restored?.state.view.kind, "submit-note");
});
