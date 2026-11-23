import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { createInitialState } from "../src/state/create.ts";
import { enterOptionNoteMode } from "../src/state/transitions.ts";
import { panelViewport } from "../src/ui/panel-viewport.ts";
import { renderAskScreen } from "../src/ui/render.ts";
import { renderEditorBlock } from "../src/ui/render-helpers.ts";
import type { AskRenderLayout } from "../src/ui/render-types.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

const editor = {
	focused: false,
	getText: () => "",
	render: () => [],
} as never;

const bigContext = Array.from(
	{ length: 300 },
	(_, index) => `Context paragraph ${index + 1} ${"lorem ipsum ".repeat(12)}`
).join("\n\n");

function contextState() {
	return createInitialState({
		questions: [
			{
				id: "q",
				prompt: "Accept the proposal?",
				context: bigContext,
				options: [{ value: "yes", label: "Accept", recommended: true }],
			},
		],
	});
}

function render(width: number, maxRows: number, contextOffset = 0) {
	const layout: AskRenderLayout = {};
	const targets: never[] = [];
	const lines = renderAskScreen({
		config: DEFAULT_ASK_CONFIG,
		contextOffset,
		editor,
		layout,
		maxRows,
		state: contextState(),
		targets,
		theme,
		width,
	});
	return { layout, lines };
}

test("a huge context fits the row budget in the wide layout and scrolls", () => {
	const { layout, lines } = render(160, 40);
	assert(lines.length <= 40, `rendered ${lines.length} rows`);
	assert(layout.contextPane);
	assert(layout.contextPane.maxOffset > 100);
	assert(lines.some((line) => line.includes("Context paragraph 1 ")));
	assert(lines.some((line) => line.includes("more · PgDn")));
	assert(lines.some((line) => line.includes("Accept")));
	assert(lines.at(-1)?.includes("─"));

	const scrolled = render(160, 40, 60);
	assert.equal(scrolled.layout.contextPane?.offset, 60);
	assert(!scrolled.lines.some((line) => line.includes("Context paragraph 1 ")));
	assert(scrolled.lines.some((line) => line.includes("more · PgUp")));
	assert(scrolled.lines.length <= 40);
});

test("on a very wide terminal the context pane fills the space beside the options", () => {
	const { layout, lines } = render(220, 40);
	assert(layout.contextPane);
	assert.equal(layout.contextPane.x + layout.contextPane.width, 220);
	const paneRow = lines[layout.contextPane.y];
	assert.equal(paneRow.length, 220);
});

test("a huge context fits the row budget in the stacked layout", () => {
	const { layout, lines } = render(70, 30);
	assert(lines.length <= 30, `rendered ${lines.length} rows`);
	assert(layout.contextPane);
	assert.equal(layout.contextPane.x, 0);
	assert(layout.contextPane.y > 0);
	assert(lines[layout.contextPane.y].startsWith("┌"));
});

test("the pane keeps its minimum size on a tiny screen", () => {
	const { layout } = render(160, 12);
	assert(layout.contextPane);
	assert(layout.contextPane.height >= 7);
});

test("a short context is not padded or scrollable", () => {
	const state = createInitialState({
		questions: [
			{
				id: "q",
				prompt: "Short?",
				context: "one\ntwo",
				options: [{ value: "yes", label: "Yes" }],
			},
		],
	});
	const layout: AskRenderLayout = {};
	renderAskScreen({
		config: DEFAULT_ASK_CONFIG,
		editor,
		layout,
		maxRows: 40,
		state,
		theme,
		width: 160,
	});
	assert.equal(layout.contextPane?.maxOffset, 0);
	assert.equal(layout.contextPane?.height, 4);
});

test("an open comment editor keeps its rows out of the context budget", () => {
	const state = enterOptionNoteMode(contextState(), "q", "yes");
	const tallEditor = {
		focused: true,
		getText: () => "text",
		render: () => [
			"────",
			...Array.from({ length: 12 }, () => "typed"),
			"────",
		],
	} as never;
	const lines = renderAskScreen({
		config: DEFAULT_ASK_CONFIG,
		editor: tallEditor,
		maxRows: 40,
		state,
		theme,
		width: 160,
	});
	assert(lines.length <= 40, `rendered ${lines.length} rows`);
	assert.equal(lines.filter((line) => line.includes("typed")).length, 12);
});

function renderWithNote(width: number, maxRows: number) {
	const layout: AskRenderLayout = {};
	const noteEditor = {
		focused: true,
		getText: () => "a long note",
		render: () => [
			"────",
			...Array.from({ length: 6 }, () => "note text"),
			"────",
		],
	} as never;
	const lines = renderAskScreen({
		config: DEFAULT_ASK_CONFIG,
		editor: noteEditor,
		layout,
		maxRows,
		state: enterOptionNoteMode(contextState(), "q", "yes"),
		theme,
		width,
	});
	return { layout, lines };
}

test("on a wide screen the note editor gets its own column and the context narrows", () => {
	const wide = renderWithNote(184, 40);
	const noteRows = wide.lines.filter((line) => line.includes("note text"));
	assert.equal(noteRows.length, 6);
	// Each note row shares its line with the context pane, not a line of its own.
	assert(noteRows.some((row) => row.includes("lorem")));
	const plain = render(184, 40);
	assert(wide.layout.contextPane && plain.layout.contextPane);
	assert(wide.layout.contextPane.width < plain.layout.contextPane.width);
	// The pane keeps its full height because the editor no longer sits below it.
	assert(wide.layout.contextPane.height >= plain.layout.contextPane.height - 1);
	assert(wide.lines.length <= 40);
});

test("a screen too narrow for three columns keeps the note editor below the context", () => {
	const { layout, lines } = renderWithNote(100, 40);
	assert(layout.contextPane);
	const pane = layout.contextPane;
	const noteRow = lines.findIndex((line) => line.includes("note text"));
	assert(noteRow >= pane.y + pane.height, "editor starts below the pane");
	assert(lines.length <= 40);
});

test("an editor on a very wide stacked screen stops widening at a readable width", () => {
	const state = enterOptionNoteMode(
		createInitialState({
			questions: [
				{ id: "q", prompt: "Pick", options: [{ value: "a", label: "A" }] },
			],
		}),
		"q",
		"a"
	);
	const lines = renderAskScreen({
		config: DEFAULT_ASK_CONFIG,
		editor: {
			focused: true,
			getText: () => "x",
			render: (width: number) => [
				"─".repeat(width),
				"y".repeat(width),
				"─".repeat(width),
			],
		} as never,
		state,
		theme,
		width: 200,
	});
	const row = lines.find((line) => line.includes("yyyy")) ?? "";
	assert(row.length <= 111, `editor row is ${row.length} wide`);
});

test("editor rows scrolled out of view are announced", () => {
	const lines: string[] = [];
	renderEditorBlock({
		lines,
		editorLines: [
			"──────── ↑ 7 more ────────",
			"visible one",
			"visible two",
			"──────── ↓ 1 more ────────",
		],
		width: 60,
		theme,
		indent: "  ",
		availableWidth: 58,
	});
	assert.equal(lines.length, 4);
	assert(lines[0].includes("↑ 7 more lines"));
	assert(lines[3].includes("↓ 1 more line"));
	assert(!lines.some((line) => line.includes("────")));
});

test("the viewport keeps a fallback row visible when no cursor is rendered", () => {
	const lines = Array.from({ length: 60 }, (_, index) => `row ${index}`);
	const view = panelViewport(lines, 10, 0, true, 40);
	assert.equal(view.offset, 31);
	const marked = [...lines];
	marked[5] = `${CURSOR_MARKER}cursor`;
	assert.equal(panelViewport(marked, 10, 0, true, 40).offset, 0);
});
