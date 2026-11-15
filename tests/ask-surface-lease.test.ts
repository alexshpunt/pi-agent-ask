import assert from "node:assert/strict";
import test from "node:test";
import { reserveAskSurface } from "../src/ask-surface.ts";
import { AskSurfaceLease } from "../src/ask-surface-lease.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a hidden panel releases its place and reopening waits behind the active foreground", async (t) => {
	const lease = new AskSurfaceLease({
		hidden: false,
		changed: () => undefined,
	});
	const foreground = reserveAskSurface();
	t.after(() => {
		lease.dispose();
		foreground.cancel();
	});
	await lease.ready();
	assert.equal(lease.visible, true);
	const acquired = foreground.acquire();
	await lease.setHidden(true);
	await acquired;
	assert.equal(lease.visible, false);
	const reopened = lease.setHidden(false);
	await tick();
	assert.equal(lease.visible, false);
	foreground.cancel();
	await reopened;
	assert.equal(lease.visible, true);
});

test("disposing during a pending reopen cannot revive the old panel or block the next form", async () => {
	const foreground = reserveAskSurface();
	await foreground.acquire();
	let changes = 0;
	const lease = new AskSurfaceLease({
		hidden: true,
		changed: () => {
			changes += 1;
		},
	});
	const reopened = lease.setHidden(false);
	lease.dispose();
	await reopened;
	const next = reserveAskSurface();
	foreground.cancel();
	await next.acquire();
	assert.equal(lease.visible, false);
	assert.equal(changes, 0);
	next.cancel();
});

test("repeated reopen requests keep one FIFO reservation and a second hide cancels it", async (t) => {
	const foreground = reserveAskSurface();
	await foreground.acquire();
	const lease = new AskSurfaceLease({ hidden: true, changed: () => undefined });
	t.after(() => {
		foreground.cancel();
		lease.dispose();
	});
	const first = lease.setHidden(false);
	const second = lease.setHidden(false);
	assert.equal(first, second);
	const next = reserveAskSurface();
	t.after(() => next.cancel());
	await lease.setHidden(true);
	await Promise.all([first, second]);
	foreground.cancel();
	await next.acquire();
	assert.equal(lease.visible, false);
});
