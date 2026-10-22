import assert from "node:assert/strict";
import test from "node:test";
import { beginUserWait } from "../src/herdr-wait-state.ts";

test("ending a foreground form cannot clear a separate active answer wait", () => {
	const updates: Array<{ active: boolean; label?: string }> = [];
	const events = {
		emit(_name: string, data: { active: boolean; label?: string }) {
			updates.push(data);
		},
	};
	const endWait = beginUserWait(events, "Waiting for user answers");
	const endForm = beginUserWait(events, "Waiting for user response");
	endForm();
	assert.deepEqual(updates.at(-1), {
		active: true,
		label: "Waiting for user answers",
	});
	assert(!updates.some((update) => !update.active));
	endWait();
	assert.deepEqual(updates.at(-1), { active: false });
	const count = updates.length;
	endForm();
	endWait();
	assert.equal(updates.length, count);
});

test("broken status listeners never prevent wait registration or cleanup", () => {
	const events = {
		emit() {
			throw new Error("unavailable");
		},
	};
	const end = beginUserWait(events, "Waiting for user answers");
	assert.doesNotThrow(end);
	assert.doesNotThrow(() => beginUserWait(undefined, "Waiting")());
});
