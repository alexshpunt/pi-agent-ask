import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { panelViewport } from "../src/ui/panel-viewport.ts";

test("a long panel stays bounded and follows the active answer editor", () => {
	const lines = Array.from({ length: 30 }, (_, index) => `row ${index}`);
	lines[22] = `${CURSOR_MARKER}answer draft`;
	const view = panelViewport(lines, 8, 0, true);
	assert.equal(view.lines.length, 8);
	assert(view.lines.some((line) => line.includes("answer draft")));
	assert(view.offset > 0);
});

test("manual scrolling can inspect content away from the active selection", () => {
	const lines = Array.from({ length: 20 }, (_, index) => `row ${index}`);
	lines[2] = "❯ selected option";
	const view = panelViewport(lines, 6, 10, false);
	assert.equal(view.offset, 10);
	assert.equal(view.lines[0], "row 10");
	assert.equal(view.lines.length, 6);
});

test("resizing and short forms never leave a blank viewport beyond the content", () => {
	const view = panelViewport(["question", "❯ answer"], 10, 40, false);
	assert.equal(view.offset, 0);
	assert.deepEqual(view.lines, ["question", "❯ answer"]);
});

test("an arrow in question content is not a renderer-owned selection marker", () => {
	const lines = Array.from({ length: 30 }, (_, index) => `row ${index}`);
	lines[1] = "The command prompt contains ❯ in its text";
	assert.equal(panelViewport(lines, 8, 12, true).offset, 12);
});
