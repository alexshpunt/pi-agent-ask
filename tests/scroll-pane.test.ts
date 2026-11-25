import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderScrollPane } from "../src/ui/scroll-pane.ts";

const plain = {
	fg: (_color: string, text: string) => text,
} as never;

const numbered = (count: number) =>
	Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

test("a pane without a height budget shows all of its content", () => {
	const pane = renderScrollPane({
		text: numbered(40),
		theme: plain,
		width: 30,
	});
	assert.equal(pane.lines.length, 42);
	assert.equal(pane.maxOffset, 0);
	assert(!pane.lines.some((line) => line.includes("more")));
});

test("a pane limits itself to its row budget and reports hidden rows", () => {
	const pane = renderScrollPane({
		height: 10,
		text: numbered(40),
		theme: plain,
		width: 30,
	});
	assert.equal(pane.lines.length, 10);
	assert.equal(pane.maxOffset, 32);
	assert(pane.lines[0].includes("↑") === false);
	assert(pane.lines.at(-1)?.includes("↓ 32 more"));
	assert(pane.lines[1].includes("line 1"));
});

test("scrolling moves the window and clamps at both ends", () => {
	const middle = renderScrollPane({
		height: 10,
		offset: 10,
		text: numbered(40),
		theme: plain,
		width: 30,
	});
	assert(middle.lines[0].includes("↑ 10 more"));
	assert(middle.lines[1].includes("line 11"));
	assert(middle.lines.at(-1)?.includes("↓ 22 more"));

	const end = renderScrollPane({
		height: 10,
		offset: 999,
		text: numbered(40),
		theme: plain,
		width: 30,
	});
	assert.equal(end.offset, 32);
	assert(end.lines.at(-2)?.includes("line 40"));
	assert(!end.lines.at(-1)?.includes("↓"));
});

test("a tiny budget still keeps a usable pane", () => {
	const pane = renderScrollPane({
		height: 2,
		text: numbered(40),
		theme: plain,
		width: 30,
	});
	assert.equal(pane.lines.length, 7);
});

test("long lines wrap to the pane width and keep their inner spacing", () => {
	const pane = renderScrollPane({
		text: `${"word ".repeat(30)}\ncode    aligned`,
		theme: plain,
		width: 30,
	});
	for (const line of pane.lines) {
		assert.equal(visibleWidth(line), 30);
	}
	assert(pane.lines.length > 5);
	assert(pane.lines.some((line) => line.includes("code    aligned")));
});

test("a thumb on the right border follows the scroll position", () => {
	const top = renderScrollPane({
		height: 12,
		text: numbered(100),
		theme: plain,
		width: 30,
	});
	const bottom = renderScrollPane({
		height: 12,
		offset: 999,
		text: numbered(100),
		theme: plain,
		width: 30,
	});
	const thumbRow = (lines: string[]) =>
		lines.findIndex((line) => line.endsWith("┃"));
	assert.equal(thumbRow(top.lines), 1);
	assert(thumbRow(bottom.lines) >= 8);
});
