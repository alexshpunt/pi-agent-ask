import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../src/state/create.ts";
import { getRenderableOptions } from "../src/state/selectors.ts";
import {
	applyNumberShortcut,
	enterOptionNoteMode,
	enterQuestionNoteMode,
} from "../src/state/transitions.ts";
import { renderQuestionScreen } from "../src/ui/render-question.ts";

function mockTheme(onColor?: (color: string, text: string) => void) {
	return {
		fg(color: string, text: string) {
			onColor?.(color, text);
			return onColor ? text : `<${color}>${text}</${color}>`;
		},
		bg(color: string, text: string) {
			return onColor ? text : `{${color}}${text}{/${color}}`;
		},
		bold(text: string) {
			return text;
		},
	} as never;
}

function mockEditor(text = "", renderedLines?: string[]) {
	return {
		getText() {
			return text;
		},
		render() {
			return renderedLines ?? [];
		},
	} as never;
}

test("custom option stays labeled before selection", () => {
	const state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick one",
				options: [{ value: "a", label: "A" }],
			},
		],
	});

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor(),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 80,
	});

	assert(lines.some((line) => line.includes("Type your own")));
	assert(!lines.some((line) => line.includes("Type your answer...")));
});

test("standard options show recommendation metadata without changing answers", () => {
	let state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick one",
				options: [
					{
						value: "a",
						label: "Option A",
						description: "Best fit for the stated constraints",
						recommended: true,
					},
					{ value: "b", label: "Option B" },
				],
			},
		],
	});

	const lines: string[] = [];
	const calls: Array<{ color: string; text: string }> = [];
	renderQuestionScreen({
		editor: mockEditor(),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme((color, text) => calls.push({ color, text })),
		width: 80,
	});

	assert(lines.some((line) => line.includes("(recommended) | Best fit")));
	assert(
		calls.some(
			(call) => call.color === "warning" && call.text === "(recommended)"
		)
	);
	assert(
		calls.some(
			(call) =>
				call.color === "muted" &&
				call.text === " | Best fit for the stated constraints"
		)
	);
	assert.equal(state.answers.q1, undefined);

	state = applyNumberShortcut(state, 1);
	assert.equal(state.answers.q1.selected[0]?.label, "Option A");
});

test("selected custom option keeps its label and renders editor below", () => {
	let state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick one",
				options: [{ value: "a", label: "A" }],
			},
		],
	});
	state = applyNumberShortcut(state, 2);

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor("", ["┌────┐", "", "└────┘"]),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 80,
	});

	assert(lines.some((line) => line.includes("Type your own")));
	assert(lines.some((line) => line.includes("Type answer...")));
});

test("open question note renders inline label and editor", () => {
	const state = enterQuestionNoteMode(
		createInitialState({
			questions: [
				{
					id: "q1",
					prompt: "Pick any extra things to include.",
					options: [{ value: "a", label: "A" }],
				},
			],
		}),
		"q1"
	);

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor("", ["┌────┐", "", "└────┘"]),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 80,
	});

	const promptIndex = lines.findIndex((line) =>
		line.includes("Pick any extra things to include.")
	);
	const inputIndex = lines.findIndex((line) => line.includes("Add a note..."));

	assert.notEqual(promptIndex, -1);
	assert.equal(inputIndex, promptIndex + 1);
	assert(!lines.some((line) => line.includes("Note:")));
});

test("open option note renders flush below the option", () => {
	const state = enterOptionNoteMode(
		createInitialState({
			questions: [
				{
					id: "q1",
					prompt: "Pick one",
					options: [{ value: "a", label: "Option A" }],
				},
			],
		}),
		"q1",
		"a"
	);

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor("", ["┌────┐", "", "└────┘"]),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 80,
	});

	const optionIndex = lines.findIndex((line) => line.includes("Option A"));
	const inputIndex = lines.findIndex((line) => line.includes("Add a note..."));

	assert.notEqual(optionIndex, -1);
	assert.equal(inputIndex, optionIndex + 1);
});

test("selected multiline custom option renders full editor block", () => {
	let state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick one",
				options: [{ value: "a", label: "A" }],
			},
		],
	});
	state = applyNumberShortcut(state, 2);

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor("first line\nsecond line", [
			"┌────┐",
			"first line",
			"second line",
			"└────┘",
		]),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 80,
	});

	assert(lines.some((line) => line.includes("Type your own")));
	assert(lines.some((line) => line.includes("first line")));
	assert(lines.some((line) => line.includes("second line")));
	assert(!lines.some((line) => line.includes("first line second line")));
});

test("questions with context show the context, custom, and recommended options", () => {
	const state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick one",
				context: "Context line one\nContext line two",
				options: [{ value: "a", label: "A", recommended: true }],
			},
		],
	});

	const lines: string[] = [];
	const calls: Array<{ color: string; text: string }> = [];
	renderQuestionScreen({
		editor: mockEditor(),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme((color, text) => calls.push({ color, text })),
		width: 80,
	});

	assert(lines.some((line) => line.includes("Type your own")));
	assert(lines.some((line) => line.includes("Context line one")));
	assert(lines.some((line) => line.includes("Context line two")));
	assert(lines.some((line) => line.trim() === "(recommended)"));
	assert(
		calls.some(
			(call) => call.color === "warning" && call.text === "(recommended)"
		)
	);
	assert(
		!calls.some((call) => call.color === "muted" && call.text.startsWith(" |"))
	);
	assert.equal(state.answers.q1, undefined);
});

test("multi-select questions with context keep their checkboxes beside the context", () => {
	const state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick any",
				type: "multi",
				context: "Shared context",
				options: [
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
				],
			},
		],
	});

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor(),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 120,
	});

	assert(lines.some((line) => line.includes("1. [ ] A")));
	const contextLine = lines.find((line) => line.includes("Shared context"));
	assert(contextLine?.includes("2. [ ] B"));
});

test("questions with context show saved notes on every option, not only the focused one", () => {
	for (const width of [60, 120]) {
		let state = createInitialState({
			questions: [
				{
					id: "q1",
					prompt: "Pick any",
					type: "multi",
					context: "Shared context",
					options: [
						{ value: "a", label: "A" },
						{ value: "b", label: "B" },
					],
				},
			],
		});
		state = enterOptionNoteMode(state, "q1", "b");
		state = {
			...state,
			activeOptionIndex: 0,
			view: { kind: "navigate" },
			answers: { q1: { selected: [], optionNotes: { b: "note on B" } } },
		};

		const lines: string[] = [];
		renderQuestionScreen({
			editor: mockEditor(),
			lines,
			options: getRenderableOptions(state.questions[0]),
			question: state.questions[0],
			state,
			theme: mockTheme(() => undefined),
			width,
		});

		assert(
			lines.some((line) => line.includes("note on B")),
			`width ${width}`
		);
	}
});

test("custom option with context reuses the normal inline editor", () => {
	let state = createInitialState({
		questions: [
			{
				id: "q1",
				prompt: "Pick one",
				context: "Context A",
				options: [{ value: "a", label: "A" }],
			},
		],
	});
	state = applyNumberShortcut(state, 2);

	const lines: string[] = [];
	renderQuestionScreen({
		editor: mockEditor("", ["┌────┐", "", "└────┘"]),
		lines,
		options: getRenderableOptions(state.questions[0]),
		question: state.questions[0],
		state,
		theme: mockTheme(),
		width: 80,
	});

	assert(lines.some((line) => line.includes("Type your own")));
	assert(lines.some((line) => line.includes("Type answer...")));
	const optionIndex = lines.findIndex((line) => line.includes("Type your own"));
	const inputIndex = lines.findIndex((line) => line.includes("Type answer..."));
	assert.equal(inputIndex, optionIndex + 1);
	assert(!lines.some((line) => line.includes("Context A")));
});
