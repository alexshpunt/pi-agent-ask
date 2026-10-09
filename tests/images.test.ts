import assert from "node:assert/strict";
import test from "node:test";
import { imageContent } from "../src/images.ts";
import { createInitialState } from "../src/state/create.ts";
import { getEditorImages, setEditorImages } from "../src/state/editor.ts";
import { toAskResult } from "../src/state/result.ts";
import {
	enterInputMode,
	enterOptionNoteMode,
	enterQuestionNoteMode,
	saveCustomAnswer,
	saveNote,
	toggleCurrentOption,
} from "../src/state/transitions.ts";

const questionNoteContext = /q.*question note/i;
const image = { id: "image-1", mimeType: "image/png", data: "aGVsbG8=" };
const params = {
	questions: [
		{
			id: "q",
			prompt: "What do you mean?",
			type: "multi" as const,
			options: [{ value: "yes", label: "Yes" }],
		},
	],
};

test("image-only answers survive editing and can be deselected without losing their draft", () => {
	let state = enterInputMode(createInitialState(params), "q");
	state = setEditorImages(state, [image]);
	state = saveCustomAnswer(state, "");
	assert.deepEqual(toAskResult(state).answers.q.customImages, [image]);
	assert.deepEqual(getEditorImages(enterInputMode(state, "q")), [image]);
	state = toggleCurrentOption({ ...state, activeOptionIndex: 1 });
	assert.equal(toAskResult(state).answers.q, undefined);
	assert.deepEqual(getEditorImages(enterInputMode(state, "q")), [image]);
});

test("image-only notes on unselected options are sent only for clarification", () => {
	let state = enterOptionNoteMode(createInitialState(params), "q", "yes");
	state = saveNote(setEditorImages(state, [image]), "");
	assert.equal(toAskResult(state).answers.q, undefined);
	const result = toAskResult({ ...state, mode: "elaborate" });
	const item = result.elaboration?.items[0];
	assert(item && "selected" in item);
	assert.equal(item.selected, false);
	assert.deepEqual(result.elaboration?.items[0].images, [image]);
	assert.deepEqual(
		imageContent(result).filter((part) => part.type === "image"),
		[{ type: "image", mimeType: image.mimeType, data: image.data }]
	);
});

test("image content keeps note associations and never sends cancelled attachments", () => {
	let state = enterQuestionNoteMode(createInitialState(params), "q");
	state = saveNote(setEditorImages(state, [image]), "See this");
	const result = toAskResult(state);
	const content = imageContent(result);
	assert.equal(content[0].type, "text");
	assert.match(
		content[0].type === "text" ? content[0].text : "",
		questionNoteContext
	);
	assert.equal(content[1].type, "image");
	assert.deepEqual(imageContent({ ...result, cancelled: true }), []);
});

test("removing one image keeps the other attachment and text", () => {
	let state = enterInputMode(createInitialState(params), "q");
	state = setEditorImages(state, [image, { ...image, id: "image-2" }]);
	state = setEditorImages(state, getEditorImages(state).slice(0, -1));
	state = saveCustomAnswer(state, "Example");
	assert.deepEqual(toAskResult(state).answers.q.customImages, [image]);
	assert.equal(toAskResult(state).answers.q.customText, "Example");
});
