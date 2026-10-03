import assert from "node:assert/strict";
import test from "node:test";
import { withAskSurface } from "../src/ask-surface.ts";

test("aborting a queued ask stops promptly without letting later surfaces overtake the active form", async () => {
	let finish: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const first = withAskSurface(undefined, () => held);
	const abort = new AbortController();
	const second = withAskSurface(abort.signal, () => {
		throw new Error("Aborted form must not open");
	});
	let thirdOpened = false;
	const third = withAskSurface(undefined, () => {
		thirdOpened = true;
		return Promise.resolve();
	});
	abort.abort();
	await assert.rejects(second, { name: "AbortError" });
	assert.equal(thirdOpened, false);
	finish?.();
	await Promise.all([first, third]);
	assert.equal(thirdOpened, true);
});
