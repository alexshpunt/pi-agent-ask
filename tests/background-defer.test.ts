import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundAskRuntime } from "../src/background-ask.ts";
import { restoreQueuedRequests } from "../src/background-ask-state.ts";

function queue() {
	const branch: any[] = [];
	const events: unknown[] = [];
	const runtime = new BackgroundAskRuntime({
		appendEntry(customType: string, data: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		events: { emit: (_name: string, data: unknown) => events.push(data) },
	} as never);
	const ctx = {
		mode: "print",
		sessionManager: { getBranch: () => branch },
		ui: { setStatus: () => undefined },
	} as never;
	runtime.enqueue(
		"pending",
		{
			questions: [
				{
					id: "choice",
					prompt: "Choose?",
					options: [{ value: "yes", label: "Yes" }],
				},
			],
		},
		ctx,
		false
	);
	return { runtime, branch, events };
}

for (const reason of ["hidden", "user_message"] as const) {
	test(`${reason} releases only the wait and keeps pending requests recoverable`, async () => {
		const { runtime, branch, events } = queue();
		try {
			const waiting = runtime.wait(undefined);
			runtime.defer(reason);
			assert.deepEqual(await waiting, {
				status: "deferred",
				reason,
				requestIds: ["pending"],
				pendingRequestIds: ["pending"],
				results: [],
			});
			assert.equal(runtime.pendingCount(), 1);
			assert.equal(restoreQueuedRequests(branch)[0].completion, undefined);
			assert.deepEqual(events, [
				{ active: true, label: "Waiting for user answers" },
				{ active: false },
			]);
		} finally {
			runtime.dispose();
		}
	});
}

test("deferring without an active wait does not report the agent as blocked", () => {
	const { runtime, events } = queue();
	try {
		runtime.defer("hidden");
		assert.equal(runtime.pendingCount(), 1);
		assert.deepEqual(events, []);
	} finally {
		runtime.dispose();
	}
});
