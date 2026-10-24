import assert from "node:assert/strict";
import test from "node:test";
import { renderResultText } from "../src/result.ts";
import { createInitialState } from "../src/state/create.ts";
import { summarizeResult, toAskResult } from "../src/state/result.ts";
import {
	applyNumberShortcut,
	confirmCurrentSelection,
	enterOptionNoteMode,
	enterQuestionNoteMode,
	moveOption,
	saveNote,
	submitCustomAnswer,
	toggleCurrentMultiOption,
} from "../src/state/transitions.ts";

/** The note must be on one line that also names its option. */
function assertNoteLine(text: string, optionValue: string, note: string) {
	const line = text.split("\n").find((candidate) => candidate.includes(note));
	assert.ok(line, `missing note "${note}" in:\n${text}`);
	assert.ok(line.includes(optionValue), `note is not attributed: ${line}`);
}

test("summarizeResult formats selected answers", () => {
	let state = createInitialState({
		questions: [
			{
				id: "style",
				label: "Style",
				prompt: "How should I frame it?",
				options: [
					{ value: "minimal", label: "Minimal" },
					{ value: "rich", label: "Rich" },
				],
			},
		],
	});

	state = applyNumberShortcut(state, 2);
	const result = toAskResult(state);

	assert.equal(summarizeResult(result), "Style: Rich");
	assert.equal(renderResultText(result), "✓ Style: Rich");
});

test("submitted results surface unanswered questions without serializing answers", () => {
	let state = createInitialState({
		questions: [
			{
				id: "architecture",
				label: "Architecture",
				prompt: "How should we wire secrets?",
				options: [{ value: "encrypted", label: "Encrypted" }],
			},
			{
				id: "sources",
				label: "Secret sources",
				prompt: "Where do secrets come from?",
				type: "multi",
				options: [{ value: "env", label: ".env file" }],
			},
		],
	});

	state = applyNumberShortcut(state, 1);
	state = confirmCurrentSelection(state);
	state = confirmCurrentSelection(state);
	const result = toAskResult(state);

	assert.equal(result.answers.sources, undefined);
	assert.equal(
		summarizeResult(result),
		"Architecture: Encrypted\nSecret sources: (no answer)"
	);
	assert.equal(
		renderResultText(result),
		"✓ Architecture: Encrypted\n? Secret sources: (no answer)"
	);
});

test("submitted results surface every question when all are unanswered", () => {
	const result = {
		cancelled: false,
		questions: [
			{
				id: "scope",
				label: "Scope",
				prompt: "What scope?",
				type: "single" as const,
			},
			{
				id: "tests",
				label: "Tests",
				prompt: "Which tests?",
				type: "multi" as const,
			},
		],
		answers: {},
	};
	assert.equal(
		summarizeResult(result),
		"Scope: (no answer)\nTests: (no answer)"
	);
	assert.equal(
		renderResultText(result),
		"? Scope: (no answer)\n? Tests: (no answer)"
	);
});

test("single questions presented as multi preserve requested type in results", () => {
	let state = createInitialState(
		{
			questions: [
				{
					id: "scope",
					label: "Scope",
					prompt: "What scope?",
					options: [
						{ value: "docs", label: "Docs" },
						{ value: "tests", label: "Tests" },
					],
				},
			],
		},
		{ presentSingleAsMulti: true }
	);

	state = toggleCurrentMultiOption(state);
	state = moveOption(state, 1);
	state = toggleCurrentMultiOption(state);
	const result = toAskResult(state);

	assert.deepEqual(result.questions, [
		{
			id: "scope",
			label: "Scope",
			prompt: "What scope?",
			type: "single",
			presentedType: "multi",
		},
	]);
	assert.equal(
		summarizeResult(result),
		"Scope: Docs, Tests\nNote: Some questions were presented as multi-select by user preference."
	);
	assert.equal(
		renderResultText(result),
		"✓ Scope: Docs, Tests\n  Note: Some questions were presented as multi-select by user preference."
	);
});

test("presentation override summary uses one compact note", () => {
	const result = {
		cancelled: false,
		questions: [
			{
				id: "apiStyle",
				label: "Single Select",
				prompt: "Pick one API style.",
				type: "single" as const,
				presentedType: "multi" as const,
			},
			{
				id: "docsSections",
				label: "Multi Select",
				prompt: "Which docs sections should be updated?",
				type: "multi" as const,
			},
			{
				id: "layout",
				label: "Layout",
				prompt: "Choose a layout.",
				type: "single" as const,
				presentedType: "multi" as const,
			},
		],
		answers: {
			apiStyle: {
				values: ["rest", "graphql"],
				labels: ["REST", "GraphQL"],
				indices: [1, 2],
			},
			docsSections: {
				values: ["readme", "contract", "architecture"],
				labels: ["README", "Contract", "Architecture"],
				indices: [1, 2, 3],
			},
			layout: {
				values: ["compact", "detailed"],
				labels: ["Compact", "Detailed"],
				indices: [1, 2],
			},
		},
	};

	assert.equal(
		summarizeResult(result),
		[
			"Single Select: REST, GraphQL",
			"Multi Select: README, Contract, Architecture",
			"Layout: Compact, Detailed",
			"Note: Some questions were presented as multi-select by user preference.",
		].join("\n")
	);
});

test("summaries include custom text answers", () => {
	let state = createInitialState({
		questions: [
			{
				id: "notes",
				label: "Notes",
				prompt: "Anything else?",
				options: [{ value: "none", label: "None" }],
			},
		],
	});

	state = applyNumberShortcut(state, 2);
	state = submitCustomAnswer(state, "Please include examples");
	const result = toAskResult(state);

	assert.equal(summarizeResult(result), "Notes: Please include examples");
	assert.equal(
		renderResultText(result),
		"✓ Notes: (wrote) Please include examples"
	);
});

test("multi-select summaries include selected options and custom text", () => {
	let state = createInitialState({
		questions: [
			{
				id: "frameworks",
				label: "Frameworks",
				prompt: "Which frameworks?",
				type: "multi",
				options: [
					{ value: "react", label: "React" },
					{ value: "vue", label: "Vue" },
				],
			},
		],
	});

	state = applyNumberShortcut(state, 1);
	state = applyNumberShortcut(state, 3);
	state = submitCustomAnswer(state, "SolidStart");
	const result = toAskResult(state);

	assert.deepEqual(result.answers.frameworks, {
		values: ["react", "SolidStart"],
		labels: ["React", "SolidStart"],
		indices: [1],
		customText: "SolidStart",
		note: undefined,
		optionNotes: undefined,
	});
	assert.equal(summarizeResult(result), "Frameworks: React, SolidStart");
	assert.equal(renderResultText(result), "✓ Frameworks: React, SolidStart");
});

test("summaries and result text include question and selected option notes", () => {
	let state = createInitialState({
		questions: [
			{
				id: "framework",
				label: "Framework",
				prompt: "Pick a framework",
				options: [
					{ value: "react", label: "React" },
					{ value: "vue", label: "Vue" },
				],
			},
		],
	});

	state = enterQuestionNoteMode(state, "framework");
	state = saveNote(state, "Need SSR support");
	state = enterOptionNoteMode(state, "framework", "vue");
	state = saveNote(state, "Team has prior experience");
	state = applyNumberShortcut(state, 2);
	const result = toAskResult(state);

	assert.equal(
		summarizeResult(result),
		[
			"Framework: Vue",
			"Framework note: Need SSR support",
			"Framework / Vue note: Team has prior experience",
		].join("\n")
	);
	assert.equal(
		renderResultText(result),
		[
			"✓ Framework: Vue",
			"  note: Need SSR support",
			"  Vue note: Team has prior experience",
		].join("\n")
	);
});

test("submitted results keep notes on options the user did not select", () => {
	let state = createInitialState({
		questions: [
			{
				id: "framework",
				label: "Framework",
				prompt: "Pick a framework",
				options: [
					{ value: "react", label: "React" },
					{ value: "vue", label: "Vue" },
				],
			},
		],
	});

	state = enterOptionNoteMode(state, "framework", "react");
	state = saveNote(state, "Only for legacy projects");
	state = applyNumberShortcut(state, 2);
	const result = toAskResult(state);

	assert.deepEqual(result.answers.framework.values, ["vue"]);
	assert.deepEqual(result.answers.framework.optionNotes, {
		react: "Only for legacy projects",
	});
	for (const text of [summarizeResult(result), renderResultText(result)]) {
		assertNoteLine(text, "react", "Only for legacy projects");
	}
});

test("question-note-only results still render note content", () => {
	const result = {
		title: "Interview",
		cancelled: false,
		questions: [
			{
				id: "scope",
				label: "Scope",
				prompt: "What should we focus on?",
				type: "single" as const,
			},
		],
		answers: {
			scope: {
				values: [],
				labels: [],
				indices: [],
				note: "Prefer incremental changes",
			},
		},
	};

	assert.equal(
		renderResultText(result),
		"? Scope: (no answer)\n  note: Prefer incremental changes"
	);
	assert.equal(
		summarizeResult(result),
		"Scope: (no answer)\nScope note: Prefer incremental changes"
	);
});

test("notes submitted without an answer still reach the agent", () => {
	let state = createInitialState({
		questions: [
			{
				id: "framework",
				label: "Framework",
				prompt: "Pick a framework",
				options: [
					{ value: "react", label: "React" },
					{ value: "vue", label: "Vue" },
				],
			},
		],
	});

	state = enterQuestionNoteMode(state, "framework");
	state = saveNote(state, "Need SSR support");
	state = enterOptionNoteMode(state, "framework", "react");
	state = saveNote(state, "Legacy codebase");
	const result = toAskResult(state);

	assert.deepEqual(result.answers.framework, {
		values: [],
		labels: [],
		indices: [],
		customText: undefined,
		note: "Need SSR support",
		optionNotes: { react: "Legacy codebase" },
	});
	for (const text of [summarizeResult(result), renderResultText(result)]) {
		assert(text.includes("Need SSR support"));
		assertNoteLine(text, "react", "Legacy codebase");
	}
});

test("invalid tool payload result is attributed to the tool call", () => {
	const result = {
		title: "Interview",
		cancelled: true,
		questions: [],
		answers: {},
		error: {
			kind: "invalid_input" as const,
			issues: [],
		},
	};

	assert.equal(renderResultText(result), "Invalid tool payload");
});

test("cancelled result hides unanswered questions", () => {
	const result = {
		title: "Interview",
		cancelled: true,
		questions: [
			{
				id: "scope",
				label: "Scope",
				prompt: "What scope?",
				type: "single" as const,
			},
		],
		answers: {},
	};

	assert.equal(summarizeResult(result), "User cancelled the ask flow");
	assert.equal(renderResultText(result), "Cancelled");
});
