import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { successfulResponse } from "../src/ask-tool-helpers.ts";
import { AskResultSchema } from "../src/result-schema.ts";
import { createInitialState } from "../src/state/create.ts";
import { toAskResult } from "../src/state/result.ts";
import {
	applyNumberShortcut,
	enterOptionNoteMode,
	enterQuestionNoteMode,
	saveNote,
} from "../src/state/transitions.ts";

function answeredState() {
	return applyNumberShortcut(
		createInitialState({
			questions: [
				{
					id: "choice",
					prompt: "Choose",
					type: "preview",
					options: [
						{
							value: "doc",
							label: "Document",
							preview: "File text",
							recommended: true,
						},
					],
				},
			],
		}),
		1
	);
}

test("submitted and cancelled results match the structured output schema", () => {
	for (const cancelled of [false, true]) {
		const result = toAskResult({ ...answeredState(), cancelled });
		const response = successfulResponse(result);
		assert.deepEqual(response.structuredContent, result);
		assert.equal(
			Value.Check(AskResultSchema, response.structuredContent),
			true
		);
		assert.deepEqual(result.answers.choice.values, ["doc"]);
	}
});

test("elaboration preserves question and option notes in structured output", () => {
	let state = answeredState();
	state = saveNote(
		enterQuestionNoteMode(state, "choice"),
		"Explain the document"
	);
	state = saveNote(
		enterOptionNoteMode(state, "choice", "doc"),
		"Why this one?"
	);
	const result = toAskResult({ ...state, mode: "elaborate" });
	const response = successfulResponse(result);
	assert.equal(Value.Check(AskResultSchema, response.structuredContent), true);
	assert.equal(response.structuredContent.elaboration?.items.length, 2);
	assert.equal(
		response.structuredContent.continuation?.strategy,
		"refine_only"
	);
	assert.deepEqual(response.structuredContent.answers.choice.values, ["doc"]);
});

test("the output schema rejects malformed nested answers", () => {
	const result = toAskResult(answeredState());
	assert.equal(
		Value.Check(AskResultSchema, {
			...result,
			answers: { choice: { ...result.answers.choice, values: "doc" } },
		}),
		false
	);
});
