import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import {
	type AskDraft,
	AskDraftSchema,
	restoreAskDraft,
} from "../src/ask-draft.ts";
import { createInitialState } from "../src/state/create.ts";
import { cycleCurrentQuestionType } from "../src/state/question-type.ts";
import { toAskResult } from "../src/state/result.ts";
import { skipCurrentQuestion } from "../src/state/skip.ts";
import { moveTab } from "../src/state/transitions.ts";
import type { AskParams } from "../src/types.ts";

const params: AskParams = {
	title: " Draft request ",
	background: true,
	questions: [
		{
			id: " first ",
			prompt: " First decision? ",
			options: [
				{ value: "yes", label: "Yes", recommended: true },
				{ value: "no", label: "No", description: "Decline" },
			],
		},
		{
			id: "second",
			prompt: "Second decision?",
			type: "multi",
			options: [{ value: "keep", label: "Keep" }],
		},
		{
			id: "third",
			prompt: "Third decision?",
			type: "preview",
			options: [{ value: "layout", label: "Layout", preview: "Preview body" }],
		},
	],
};

function draft(): AskDraft {
	return { state: createInitialState(params), editorText: "" };
}

function roundTrip(value: AskDraft): unknown {
	return JSON.parse(JSON.stringify(value));
}

test("restoring raw answer text keeps saved answers, notes, and images unchanged", () => {
	const value = draft();
	value.state.questions[0] = {
		...value.state.questions[0],
		type: "multi",
		requestedType: "single",
		presentedType: "multi",
	};
	value.state.view = { kind: "input", questionId: "first" };
	value.state.activeOptionIndex = 2;
	const image = { id: "image", mimeType: "image/png", data: "aW1hZ2U=" };
	value.state.answers.first = {
		selected: [{ index: 1, label: "Yes", value: "yes" }],
		customSelected: true,
		customText: "previous saved answer",
		note: "saved note",
		optionNotes: { no: "saved unselected note" },
		customImages: [image],
		noteImages: [image],
		optionNoteImages: { no: [image] },
	};
	value.editorText = "  unfinished replacement\nwith trailing spaces  ";
	const restored = restoreAskDraft(roundTrip(value), params);

	assert.deepEqual(restored, roundTrip(value));
	assert.equal(
		restored?.state.answers.first?.customText,
		"previous saved answer"
	);
	assert.equal(restored?.state.activeTabIndex, 0);
	assert.deepEqual(restored?.state.view, {
		kind: "input",
		questionId: "first",
	});
	assert.equal(restored?.editorText, value.editorText);
	assert.equal(Value.Check(AskDraftSchema, roundTrip(value)), true);
});

test("restoring an option-note draft does not save its editor text", () => {
	const value = draft();
	value.state.view = { kind: "note", questionId: "first", optionValue: "no" };
	value.state.answers.first = {
		selected: [],
		optionNotes: { no: "old note" },
		optionNoteImages: {
			no: [{ id: "note-image", mimeType: "image/png", data: "aW1hZ2U=" }],
		},
	};
	value.editorText = "unsaved note";

	assert.deepEqual(restoreAskDraft(roundTrip(value), params), roundTrip(value));
	assert.equal(value.state.answers.first?.optionNotes?.no, "old note");
});

test("valid runtime presentations survive restoration", () => {
	const value = draft();
	value.state = cycleCurrentQuestionType(value.state).state;
	value.state = cycleCurrentQuestionType(moveTab(value.state, 1)).state;
	value.state = cycleCurrentQuestionType(moveTab(value.state, 1)).state;

	assert.deepEqual(restoreAskDraft(roundTrip(value), params), roundTrip(value));
	assert.deepEqual(
		value.state.questions.map((question) => question.type),
		["multi", "single", "multi"]
	);
});

test("skipped question positions and an empty active Review survive restoration", () => {
	const value = draft();
	value.state = skipCurrentQuestion(moveTab(value.state, 1));
	value.state = skipCurrentQuestion(moveTab(value.state, -1));
	value.state = skipCurrentQuestion(value.state);
	const restored = restoreAskDraft(roundTrip(value), params);

	assert.deepEqual(restored, roundTrip(value));
	assert.deepEqual(restored?.state.questions, []);
	assert.deepEqual(restored?.state.view, { kind: "submit" });
	assert.deepEqual(restored && toAskResult(restored.state).skippedQuestionIds, [
		"first",
		"second",
		"third",
	]);
});

const malformedCases: [string, unknown][] = [
	[
		"dangling question on navigation view",
		{
			...draft(),
			state: {
				...draft().state,
				view: { kind: "navigate", questionId: "foreign" },
			},
		},
	],
	["missing draft", undefined],
	["null draft", null],
	["missing editor text", { state: draft().state }],
	["non-text editor", { ...draft(), editorText: 3 }],
	[
		"missing answer selections",
		{
			...draft(),
			state: { ...draft().state, answers: { first: { note: "note" } } },
		},
	],
	[
		"invalid image data",
		{
			...draft(),
			state: {
				...draft().state,
				answers: {
					first: {
						selected: [],
						customImages: [{ id: "image", mimeType: "image/png", data: 4 }],
					},
				},
			},
		},
	],
	[
		"invalid note shape",
		{
			...draft(),
			state: {
				...draft().state,
				answers: { first: { selected: [], optionNotes: { yes: [] } } },
			},
		},
	],
	[
		"completed flow",
		{ ...draft(), state: { ...draft().state, completed: true } },
	],
	[
		"cancelled flow",
		{ ...draft(), state: { ...draft().state, cancelled: true } },
	],
	[
		"fractional active index",
		{ ...draft(), state: { ...draft().state, activeTabIndex: 0.5 } },
	],
	[
		"negative active index",
		{ ...draft(), state: { ...draft().state, activeOptionIndex: -1 } },
	],
	[
		"unknown view",
		{ ...draft(), state: { ...draft().state, view: { kind: "unknown" } } },
	],
];

for (const [name, value] of malformedCases) {
	test(`rejects ${name}`, () => {
		assert.equal(restoreAskDraft(value, params), undefined);
	});
}

const invalidStates: [string, (value: AskDraft) => void][] = [
	[
		"unknown question ID",
		(value) => {
			value.state.questions[0].id = "foreign";
		},
	],
	[
		"duplicate question ID",
		(value) => {
			value.state.questions[1].id = "first";
		},
	],
	[
		"missing question",
		(value) => {
			value.state.questions.pop();
		},
	],
	[
		"reordered questions",
		(value) => {
			value.state.questions.reverse();
		},
	],
	[
		"changed prompt",
		(value) => {
			value.state.questions[0].prompt = "Another request?";
		},
	],
	[
		"changed label",
		(value) => {
			value.state.questions[0].label = "Other label";
		},
	],
	[
		"changed option identity",
		(value) => {
			value.state.questions[0].options[0].value = "other";
		},
	],
	[
		"changed option preview",
		(value) => {
			value.state.questions[2].options[0].preview = "Other preview";
		},
	],
	[
		"changed title",
		(value) => {
			value.state.title = "Another request";
		},
	],
	[
		"invalid presentation",
		(value) => {
			value.state.questions[0].type = "preview";
		},
	],
	[
		"missing presentation metadata",
		(value) => {
			value.state.questions[0].type = "multi";
		},
	],
	[
		"wrong requested type",
		(value) => {
			value.state.questions[0].requestedType = "multi";
		},
	],
	[
		"inconsistent presentation metadata",
		(value) => {
			value.state.questions[0].presentedType = "multi";
		},
	],
	[
		"dangling answer ID",
		(value) => {
			value.state.answers.foreign = { selected: [] };
		},
	],
	[
		"unknown selected option",
		(value) => {
			value.state.answers.first = {
				selected: [{ index: 1, value: "other", label: "Other" }],
			};
		},
	],
	[
		"wrong selected option index",
		(value) => {
			value.state.answers.first = {
				selected: [{ index: 2, value: "yes", label: "Yes" }],
			};
		},
	],
	[
		"wrong selected option label",
		(value) => {
			value.state.answers.first = {
				selected: [{ index: 1, value: "yes", label: "Other" }],
			};
		},
	],
	[
		"duplicate selected option",
		(value) => {
			value.state.answers.first = {
				selected: [
					{ index: 1, value: "yes", label: "Yes" },
					{ index: 1, value: "yes", label: "Yes" },
				],
			};
		},
	],
	[
		"multiple selections on single question",
		(value) => {
			value.state.answers.first = {
				selected: [
					{ index: 1, value: "yes", label: "Yes" },
					{ index: 2, value: "no", label: "No" },
				],
			};
		},
	],
	[
		"dangling option note",
		(value) => {
			value.state.answers.first = {
				selected: [],
				optionNotes: { other: "note" },
			};
		},
	],
	[
		"dangling option images",
		(value) => {
			value.state.answers.first = {
				selected: [],
				optionNoteImages: { other: [] },
			};
		},
	],
	[
		"out-of-range tab",
		(value) => {
			value.state.activeTabIndex = 4;
		},
	],
	[
		"out-of-range option",
		(value) => {
			value.state.activeOptionIndex = 3;
		},
	],
	[
		"out-of-range Review action",
		(value) => {
			value.state.activeSubmitActionIndex = 3;
		},
	],
	[
		"Review view on question tab",
		(value) => {
			value.state.view = { kind: "submit" };
		},
	],
	[
		"question view on Review tab",
		(value) => {
			value.state.activeTabIndex = 3;
		},
	],
	[
		"dangling editor question",
		(value) => {
			value.state.view = { kind: "input", questionId: "foreign" };
		},
	],
	[
		"editor on another question",
		(value) => {
			value.state.view = { kind: "input", questionId: "second" };
		},
	],
	[
		"dangling note option",
		(value) => {
			value.state.view = {
				kind: "note",
				questionId: "first",
				optionValue: "other",
			};
		},
	],
	[
		"skipped question with wrong position",
		(value) => {
			value.state = skipCurrentQuestion(value.state);
			if (value.state.skippedQuestions?.[0]) {
				value.state.skippedQuestions[0].index = 1;
			}
		},
	],
	[
		"duplicate skipped question",
		(value) => {
			value.state = skipCurrentQuestion(value.state);
			if (value.state.skippedQuestions?.[0]) {
				value.state.skippedQuestions.push(value.state.skippedQuestions[0]);
			}
		},
	],
	[
		"answer attached to skipped question",
		(value) => {
			value.state = skipCurrentQuestion(value.state);
			value.state.answers.first = { selected: [] };
		},
	],
];

for (const [name, change] of invalidStates) {
	test(`rejects ${name}`, () => {
		const value = draft();
		change(value);
		assert.equal(restoreAskDraft(roundTrip(value), params), undefined);
	});
}

test("a draft cannot be restored against another request with reused IDs", () => {
	const other = structuredClone(params);
	other.questions[0].options[0].label = "Approve a different action";

	assert.equal(restoreAskDraft(roundTrip(draft()), other), undefined);
	assert.equal(
		restoreAskDraft(roundTrip(draft()), { questions: [] }),
		undefined
	);
});
