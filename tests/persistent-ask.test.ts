import assert from "node:assert/strict";
import test from "node:test";
import type { AskResult } from "../src/types.ts";
import { showPersistentAsk } from "../src/ui/persistent-ask.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const answer: AskResult = {
	cancelled: false,
	mode: "submit",
	questions: [],
	answers: {},
};

function harness() {
	const editor = { getText: () => "", setText: () => undefined };
	const tui = { children: [editor] as unknown[] };
	const widgets = new Map<string, { render: () => string[] }>();
	let mounts = 0;
	const ctx = {
		ui: {
			setWidget(key: string, factory: any) {
				if (factory) {
					widgets.set(key, factory(tui));
				} else {
					widgets.delete(key);
				}
			},
			custom(factory: any) {
				return new Promise((resolve) => {
					let closed = false;
					let component: any;
					const done = (value: unknown) => {
						if (closed) {
							return;
						}
						closed = true;
						tui.children = [editor];
						resolve(value);
						component?.dispose?.();
					};
					component = factory(tui, {}, {}, done);
					tui.children = [component];
					mounts += 1;
				});
			},
		},
	};
	return {
		ctx,
		tui,
		widgets,
		get mounts() {
			return mounts;
		},
		replaceWithEditor() {
			tui.children = [editor];
			for (const widget of widgets.values()) {
				widget.render();
			}
		},
	};
}

test("a background form remount keeps the controller, draft, and completion callback", async () => {
	const h = harness();
	let created = 0;
	let disposed = 0;
	let draft = "";
	let finish: ((result: AskResult) => void) | undefined;
	const running = showPersistentAsk(
		h.ctx as never,
		(_tui, _theme, _keys, done) => {
			created += 1;
			finish = done;
			return {
				render: () => [draft],
				invalidate: () => undefined,
				handleInput: (data) => {
					draft += data;
				},
				dispose: () => {
					disposed += 1;
				},
			};
		}
	);
	const surface = h.tui.children[0] as {
		handleInput: (data: string) => void;
		render: () => string[];
	};
	surface.handleInput("saved draft");
	h.replaceWithEditor();
	await tick();
	assert.equal(h.mounts, 2);
	assert.equal(created, 1);
	assert.equal(disposed, 0);
	assert.equal(h.tui.children[0], surface);
	assert.deepEqual(surface.render(), ["saved draft"]);
	finish?.(answer);
	assert.deepEqual(await running, answer);
	assert.equal(disposed, 1);
	assert.equal(h.widgets.size, 0);
});

test("an answer during a scheduled remount finishes once without reopening", async () => {
	const h = harness();
	let finish: ((result: AskResult) => void) | undefined;
	const running = showPersistentAsk(
		h.ctx as never,
		(_tui, _theme, _keys, done) => {
			finish = done;
			return { render: () => [], invalidate: () => undefined };
		}
	);
	h.replaceWithEditor();
	finish?.(answer);
	assert.deepEqual(await running, answer);
	assert.equal(h.mounts, 1);
	assert.equal(h.widgets.size, 0);
});
