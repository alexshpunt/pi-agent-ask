import assert from "node:assert/strict";
import test from "node:test";
import type { AskResult } from "../src/types.ts";
import {
	type PersistentAskHandle,
	showPersistentAsk,
} from "../src/ui/persistent-ask.ts";

const answer: AskResult = {
	cancelled: false,
	mode: "submit",
	questions: [],
	answers: {},
};

function harness() {
	const editor = { draft: "ordinary message" };
	let focused: unknown = editor;
	const widgets = new Map<string, { render: (width: number) => string[] }>();
	let input: ((data: string) => unknown) | undefined;
	const tui = { requestRender: () => undefined };
	const ctx = {
		ui: {
			setWidget(key: string, factory: any) {
				if (factory) {
					widgets.set(key, factory(tui));
				} else {
					widgets.delete(key);
				}
			},
			onTerminalInput(handler: typeof input) {
				input = handler;
				return () => {
					input = undefined;
				};
			},
			custom(factory: any, options: any) {
				return new Promise((resolve) => {
					const component = factory(
						tui,
						{ fg: (_color: string, text: string) => text },
						{},
						(result: unknown) => {
							focused = editor;
							component.dispose?.();
							resolve(result);
						}
					);
					let hidden = false;
					const handle = {
						setHidden(value: boolean) {
							hidden = value;
							if (hidden) {
								handle.unfocus();
							}
						},
						isHidden: () => hidden,
						isFocused: () => focused === component,
						focus() {
							focused = component;
							component.focused = true;
						},
						unfocus() {
							focused = editor;
							component.focused = false;
						},
					};
					if (!options?.overlayOptions?.nonCapturing) {
						handle.focus();
					}
					options?.onHandle?.(handle);
				});
			},
		},
	};
	return {
		ctx,
		editor,
		widgets,
		get focused() {
			return focused;
		},
		get input() {
			return input;
		},
	};
}

test("a question widget leaves the editor focused and retains its controller when deferred", async () => {
	const h = harness();
	let finish: ((result: AskResult) => void) | undefined;
	let panel: PersistentAskHandle | undefined;
	let disposed = 0;
	let draft = "answer draft";
	const running = showPersistentAsk(
		h.ctx as never,
		(_tui, _theme, _keys, done) => {
			finish = done;
			return {
				render: () => [draft],
				invalidate: () => undefined,
				dispose() {
					disposed += 1;
				},
			};
		},
		{
			hidden: false,
			onHandle: (handle) => {
				panel = handle;
			},
		}
	);
	assert.equal(h.focused, h.editor);
	assert.equal(h.editor.draft, "ordinary message");
	assert(
		[...h.widgets.values()].some((widget) =>
			widget.render(80).includes("answer draft")
		)
	);
	panel?.toggleFocus();
	assert.notEqual(h.focused, h.editor);
	panel?.setHidden(true);
	assert.equal(h.focused, h.editor);
	assert(
		[...h.widgets.values()].every((widget) => widget.render(80).length === 0)
	);
	assert.equal(disposed, 0);
	draft = "preserved answer draft";
	panel?.toggleFocus();
	assert(
		[...h.widgets.values()].some((widget) => widget.render(80).includes(draft))
	);
	finish?.(answer);
	assert.deepEqual(await running, answer);
	assert.equal(disposed, 1);
	assert.equal(h.widgets.size, 0);
	assert.equal(h.input, undefined);
});
