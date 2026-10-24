import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { successfulResponse } from "../src/ask-tool-helpers.ts";
import { AskOutputSchema, AskResultSchema } from "../src/result-schema.ts";
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
					context: "File text",
					options: [
						{
							value: "doc",
							label: "Document",
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
		assert.equal(
			Value.Check(AskOutputSchema, response.structuredContent),
			true
		);
		assert.equal(Value.Check(AskResultSchema, response.details), true);
		assert.equal(response.structuredContent.cancelled, cancelled);
		assert.deepEqual(response.structuredContent.answers.choice, {
			values: ["doc"],
			labels: ["Document"],
		});
	}
});

test("structured output carries question and option notes with the answer", () => {
	let state = answeredState();
	state = saveNote(
		enterQuestionNoteMode(state, "choice"),
		"Explain the document"
	);
	state = saveNote(
		enterOptionNoteMode(state, "choice", "doc"),
		"Why this one?"
	);
	const response = successfulResponse(toAskResult(state));
	assert.equal(Value.Check(AskOutputSchema, response.structuredContent), true);
	assert.deepEqual(response.structuredContent.answers.choice, {
		values: ["doc"],
		labels: ["Document"],
		note: "Explain the document",
		optionNotes: { doc: "Why this one?" },
	});
});

test("structured output omits presentation-only result fields", () => {
	const response = successfulResponse(toAskResult(answeredState()));
	const output = response.structuredContent as Record<string, unknown>;
	for (const field of ["questions", "title"]) {
		assert.equal(field in output, false, field);
	}
	const answer = response.structuredContent.answers.choice as Record<
		string,
		unknown
	>;
	assert.equal("indices" in answer, false);
});

test("structured output flattens answer images without internal identifiers", () => {
	const image = { id: "image-1", mimeType: "image/png", data: "aGVsbG8=" };
	const result = toAskResult(answeredState());
	result.answers.choice = { ...result.answers.choice, noteImages: [image] };
	const response = successfulResponse(result);
	assert.equal(Value.Check(AskOutputSchema, response.structuredContent), true);
	assert.deepEqual(response.structuredContent.answers.choice.images, [
		{ mimeType: image.mimeType, data: image.data },
	]);
});

test("the output schemas reject malformed nested answers", () => {
	const result = toAskResult(answeredState());
	const output = successfulResponse(result).structuredContent;
	assert.equal(
		Value.Check(AskResultSchema, {
			...result,
			answers: { choice: { ...result.answers.choice, values: "doc" } },
		}),
		false
	);
	assert.equal(
		Value.Check(AskOutputSchema, {
			...output,
			answers: { choice: { ...output.answers.choice, values: "doc" } },
		}),
		false
	);
});
