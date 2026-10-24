import assert from "node:assert/strict";
import test from "node:test";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { createInitialState } from "../src/state/create.ts";
import { showPersistentAsk } from "../src/ui/persistent-ask.ts";
import { renderAskScreen } from "../src/ui/render.ts";
import type { AskMouseTarget } from "../src/ui/render-types.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function click(x: number, y: number): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x,
		y,
		screenX: x + 20,
		screenY: y + 40,
		width: 80,
		height: 20,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

test("the visible widget routes a click to its scrolled question row and takes focus explicitly", async () => {
	let widget: Component | undefined;
	let focused = false;
	let finish: (() => void) | undefined;
	const received: TuiMouseEvent[] = [];
	const tui = { terminal: { rows: 24 }, requestRender: () => undefined };
	const ctx = {
		ui: {
			setWidget(
				_key: string,
				factory: ((...args: unknown[]) => Component) | undefined
			) {
				widget = factory?.();
			},
			onTerminalInput() {
				return () => undefined;
			},
			custom(factory: (...args: any[]) => Component, options: any) {
				const component = factory(tui, theme, {}, () => undefined);
				options.onHandle({
					isFocused: () => focused,
					focus() {
						focused = true;
					},
					unfocus() {
						focused = false;
					},
					setHidden: () => undefined,
				});
				widget?.render(80);
				component.handleInput?.("\u001b[6~");
				return new Promise((resolve) => {
					finish = () =>
						resolve({
							cancelled: false,
							mode: "submit",
							questions: [],
							answers: {},
						});
				});
			},
		},
	};
	const running = showPersistentAsk(
		ctx as never,
		() => ({
			render: () => Array.from({ length: 30 }, (_, index) => `row ${index}`),
			invalidate: () => undefined,
			handleMouse(event) {
				received.push(event);
				return { handled: true };
			},
		}),
		{ hidden: false, onHandle: () => undefined }
	);
	assert(widget);
	widget.render(80);
	assert.equal(typeof widget.handleMouse, "function");
	assert.equal(focused, true, "new questions must take keyboard focus");
	focused = false;
	widget.handleMouse?.({ ...click(7, 2), type: "press" });
	assert.equal(focused, false, "press alone must not focus or answer");
	widget.handleMouse?.({ ...click(7, 2), type: "release" });
	assert.equal(focused, false, "release alone must not focus or answer");
	widget.handleMouse?.(click(7, 2));
	assert.equal(focused, true);
	assert.equal(received.length, 0, "the focus click must not reach any action");
	widget.handleMouse?.(click(7, 2));
	assert.equal(received.length, 1);
	assert.equal(received[0].y, 10);
	assert.equal(received[0].x, 7);
	assert.equal(received[0].screenY, 42);
	for (const y of [1, 4, 8]) {
		focused = false;
		widget.handleMouse?.(click(7, y));
		assert.equal(focused, true);
		assert.equal(
			received.length,
			1,
			"every body row must be focus-only when unfocused"
		);
	}
	focused = false;
	widget.handleMouse?.(click(75, 0));
	assert.equal(
		focused,
		true,
		"clicking the panel heading must give keyboard focus"
	);
	focused = false;
	widget.handleMouse?.(click(75, 10));
	assert.equal(
		focused,
		true,
		"clicking the scroll footer must give keyboard focus"
	);
	focused = false;
	widget.handleMouse?.(click(7, 12));
	assert.equal(
		focused,
		false,
		"a click outside the panel must not capture input"
	);
	assert.equal(received.length, 1);
	const removedWidget = widget;
	finish?.();
	await running;
	removedWidget.handleMouse?.(click(7, 2));
	assert.equal(received.length, 1);
});

test("wrapped option labels and descriptions expose the same exact click target", () => {
	const state = createInitialState({
		questions: [
			{
				id: "q",
				prompt: "Pick?",
				options: [
					{
						value: "a",
						label: "A long label that wraps across rows",
						description: "Description also wraps across several rows",
					},
					{ value: "b", label: "Second option" },
				],
			},
		],
	});
	const targets: AskMouseTarget[] = [];
	const lines = renderAskScreen({
		config: DEFAULT_ASK_CONFIG,
		state,
		theme: theme as never,
		width: 24,
		editor: { getText: () => "", render: () => [] } as never,
		targets,
	});
	const first = targets.find(
		(target) => target.kind === "option" && target.index === 0
	);
	assert(first);
	assert(first.height > 2);
	assert(lines[first.y].includes("1."));
	assert(
		lines
			.slice(first.y, first.y + first.height)
			.join(" ")
			.includes("Description")
	);
	const second = targets.find(
		(target) => target.kind === "option" && target.index === 1
	);
	assert(second);
	assert.equal(second.y, first.y + first.height);
});

test("wide context and review targets do not include the neighboring content pane", () => {
	const state = createInitialState({
		questions: [
			{
				id: "preview",
				prompt: "Compare",
				context: "Shared context for both options",
				options: [
					{ value: "one", label: "One" },
					{ value: "two", label: "Two" },
				],
			},
		],
	});
	for (const width of [24, 120]) {
		const targets: AskMouseTarget[] = [];
		const args = {
			config: DEFAULT_ASK_CONFIG,
			theme: theme as never,
			width,
			editor: { getText: () => "", render: () => [] } as never,
			targets,
		};
		const lines = renderAskScreen({ ...args, state });
		const option = targets.find(
			(target) => target.kind === "option" && target.index === 1
		);
		assert(option);
		assert(lines[option.y].includes("2. Two"));
		assert.equal(option.width < width, width === 120);
		targets.length = 0;
		const reviewLines = renderAskScreen({
			...args,
			state: { ...state, activeTabIndex: 1, view: { kind: "submit" } },
		});
		const submit = targets.find(
			(target) => target.kind === "submit" && target.index === 0
		);
		assert(submit);
		assert(reviewLines[submit.y].includes("1. Submit"));
		assert.equal(submit.width < width, width === 120);
	}
});
