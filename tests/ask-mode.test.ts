import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { AskModeController, getProjectAskConfigPath } from "../src/ask-mode.ts";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { AskConfigStore } from "../src/config/store.ts";

const HAS_UI = "hasUI";
async function setup(t: test.TestContext, global = false, trusted = true) {
	const root = await mkdtemp(join(tmpdir(), "pi-ask-mode-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new AskConfigStore(join(root, "global.json"));
	await store.save({
		...DEFAULT_ASK_CONFIG,
		behaviour: { ...DEFAULT_ASK_CONFIG.behaviour, backgroundOnly: global },
	});
	const changes: boolean[] = [];
	const controller = new AskModeController(store, (enabled) =>
		changes.push(enabled)
	);
	const confirmations: string[] = [];
	let accept = true;
	const ctx = {
		cwd: root,
		[HAS_UI]: true,
		isProjectTrusted: () => trusted,
		ui: {
			confirm(_title: string, message: string) {
				confirmations.push(message);
				return Promise.resolve(accept);
			},
			notify() {
				// Notices are unrelated to the policy contract in these cases.
			},
		},
	};
	const projectPath = getProjectAskConfigPath(root);
	await mkdir(dirname(projectPath), { recursive: true });
	return {
		controller,
		store,
		ctx,
		changes,
		confirmations,
		projectPath,
		setAccept: (value: boolean) => {
			accept = value;
		},
	};
}

for (const global of [false, true]) {
	for (const override of [undefined, false, true]) {
		test(`trusted project mode ${override} resolves over global ${global}`, async (t) => {
			const state = await setup(t, global);
			if (override !== undefined) {
				await writeFile(
					state.projectPath,
					JSON.stringify({ behaviour: { backgroundOnly: override } })
				);
			}
			await state.controller.initialize(state.ctx);
			assert.equal(state.controller.backgroundOnly, override ?? global);
			assert.deepEqual(state.confirmations, []);
		});
	}
}

test("untrusted project mode is ignored without reading invalid project config", async (t) => {
	const state = await setup(t, true, false);
	await writeFile(state.projectPath, "not json");
	await state.controller.initialize(state.ctx);
	assert.equal(state.controller.backgroundOnly, true);
	await assert.rejects(
		state.controller.changeMode("project", false, state.ctx)
	);
	assert.equal(await readFile(state.projectPath, "utf8"), "not json");
});

test("mode changes before the first request do not ask for cache confirmation", async (t) => {
	const state = await setup(t);
	await state.controller.initialize(state.ctx);
	assert.equal(
		await state.controller.changeMode("global", true, state.ctx),
		true
	);
	assert.equal(state.controller.backgroundOnly, true);
	assert.deepEqual(state.confirmations, []);
	assert.equal((await state.store.getConfig()).behaviour.backgroundOnly, true);
});

test("both directions require confirmation after a request and rejection changes nothing", async (t) => {
	const state = await setup(t);
	await state.controller.initialize(state.ctx);
	state.controller.markModelRequest();
	state.setAccept(false);
	assert.equal(
		await state.controller.changeMode("global", true, state.ctx),
		false
	);
	assert.equal(state.controller.backgroundOnly, false);
	assert.equal((await state.store.getConfig()).behaviour.backgroundOnly, false);
	assert.deepEqual(state.changes, []);
	state.setAccept(true);
	await state.controller.changeMode("global", true, state.ctx);
	await state.controller.changeMode("global", false, state.ctx);
	assert.equal(state.confirmations.length, 3);
	assert.deepEqual(state.changes, [true, false]);
});

test("project inheritance preserves unrelated config and prompts only for effective tool changes", async (t) => {
	const state = await setup(t, true);
	await writeFile(
		state.projectPath,
		JSON.stringify({
			behaviour: { backgroundOnly: false, showFooterHints: false },
			custom: "keep",
		})
	);
	await state.controller.initialize(state.ctx);
	state.controller.markModelRequest();
	await state.controller.changeMode("global", false, state.ctx);
	assert.equal(state.confirmations.length, 0);
	await state.controller.changeMode("global", true, state.ctx);
	assert.equal(state.confirmations.length, 0);
	await state.controller.changeMode("project", undefined, state.ctx);
	assert.equal(state.confirmations.length, 1);
	assert.equal(state.controller.backgroundOnly, true);
	assert.deepEqual(JSON.parse(await readFile(state.projectPath, "utf8")), {
		behaviour: { showFooterHints: false },
		custom: "keep",
	});
});

test("a confirmation from a replaced session cannot save or apply its old mode", async (t) => {
	const state = await setup(t);
	await state.controller.initialize(state.ctx);
	state.controller.markModelRequest();
	let confirm: (value: boolean) => void = () => {
		throw new Error("Confirmation was not opened");
	};
	let opened: () => void = () => {
		throw new Error("Wait was not initialized");
	};
	const ready = new Promise<void>((resolve) => {
		opened = resolve;
	});
	state.ctx.ui.confirm = () =>
		new Promise<boolean>((resolve) => {
			confirm = resolve;
			opened();
		});
	const pending = state.controller.changeMode("global", true, state.ctx);
	await ready;
	const rejected = assert.rejects(pending);
	await state.controller.initialize(state.ctx);
	confirm(true);
	await rejected;
	assert.equal(state.controller.backgroundOnly, false);
	assert.equal((await state.store.getConfig()).behaviour.backgroundOnly, false);
	assert.deepEqual(state.changes, []);
});

test("a failed config save does not change the effective tools", async (t) => {
	const state = await setup(t);
	await state.controller.initialize(state.ctx);
	await mkdir(state.projectPath);
	await assert.rejects(state.controller.changeMode("project", true, state.ctx));
	assert.equal(state.controller.backgroundOnly, false);
	assert.deepEqual(state.changes, []);
});
