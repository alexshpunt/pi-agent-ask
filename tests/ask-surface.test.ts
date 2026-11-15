import assert from "node:assert/strict";
import test from "node:test";
import { reserveAskSurface, withAskSurface } from "../src/ask-surface.ts";

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

test("a queued background form keeps its arrival position before its runner starts", async () => {
	const background = reserveAskSurface();
	const opened: string[] = [];
	const foreground = withAskSurface(undefined, () => {
		opened.push("foreground");
		return Promise.resolve();
	});
	await background.run(undefined, () => {
		opened.push("background");
		return Promise.resolve();
	});
	await foreground;
	assert.deepEqual(opened, ["background", "foreground"]);
});

test("disposing unused reservations lets later forms open without overtaking the active form", async () => {
	let finish: (() => void) | undefined;
	const active = withAskSurface(
		undefined,
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			})
	);
	const queued = reserveAskSurface();
	const opened: string[] = [];
	const later = withAskSurface(undefined, () => {
		opened.push("later");
		return Promise.resolve();
	});
	queued.cancel();
	queued.cancel();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(opened.length, 0);
	await assert.rejects(
		queued.run(undefined, () => {
			opened.push("cancelled");
			return Promise.resolve();
		}),
		{ name: "AbortError" }
	);
	finish?.();
	await Promise.all([active, later]);
	assert.deepEqual(opened, ["later"]);
});

test("a failed form releases its reservation for the next request", async () => {
	const first = reserveAskSurface();
	let opened = false;
	const next = withAskSurface(undefined, () => {
		opened = true;
		return Promise.resolve();
	});
	await assert.rejects(
		first.run(undefined, () => Promise.reject(new Error("Form failed"))),
		{ message: "Form failed" }
	);
	await next;
	assert.equal(opened, true);
});
