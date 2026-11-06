import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";
import { ASK_ANSWER_MESSAGE } from "../../src/background-ask-state.ts";

const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});

for (const phase of ["work", "settle", "idle"] as const) {
	test(`real Pi consumes a background answer submitted at ${phase} exactly once without waiting`, {
		timeout: 60_000,
	}, async () => {
		const cwd = await mkdtemp(join(tmpdir(), "ask-settle-"));
		try {
			const question = {
				id: `answer-${phase}`,
				prompt: `Decision for ${phase} delivery?`,
				options: [{ value: "accepted", label: `Accepted ${phase}` }],
			};
			const result = await new PiIntegrationTest({
				testName: `background-settle-${phase}`,
				artifactsDir: testArtifactsDir(import.meta.filename),
				cwd,
				isolateUserResources: true,
				rawMode: false,
				extensions: [
					fileURLToPath(
						new URL("../fixtures/settle-answer-driver.ts", import.meta.url)
					),
					fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
				],
				tools: ["ask_user", "settle_probe"],
				conversation: [
					call("form", "ask_user", { background: true, questions: [question] }),
					call("submit", "settle_probe", { phase }),
					...(phase === "work"
						? []
						: [assistantMessage([text("Independent work finished.")])]),
					call("continued", "settle_probe", {}),
					call("later", "settle_probe", {}),
					assistantMessage([text("Delivery verification finished.")]),
				],
			}).run(
				"Queue a question, finish independent work, and consume its answer without explicitly waiting."
			);
			for (const id of ["continued", "later"]) {
				const execution = getToolExecution(result, id);
				assert.equal(execution.isError, false);
				const details = getToolExecutionDetails(execution);
				assert.deepEqual(details, {
					submittedAt: phase,
					completed: 1,
					answers: 1,
				});
			}
			const receipt = getToolExecutionDetails(
				getToolExecution(result, "form")
			) as { requestId: string };
			const snapshot = result.traceEvents
				.filter((event) => event.type === "session_snapshot")
				.at(-1);
			assert(Array.isArray(snapshot?.branch));
			const answers = snapshot.branch.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === ASK_ANSWER_MESSAGE
			);
			assert.equal(answers.length, 1);
			assert.equal(answers[0].details.requestId, receipt.requestId);
			assert.equal(
				answers[0].details.result.answers[question.id].values[0],
				question.options[0].value
			);
			const request = result.providerRequests.at(-1);
			assert(Array.isArray(request?.messages));
			const delivered = request.messages.filter(
				(message) =>
					message.role === "user" &&
					JSON.stringify(message.content).includes(question.prompt)
			);
			assert.equal(delivered.length, 1);
			assert(JSON.stringify(delivered[0]).includes(question.options[0].label));
			assert.equal(result.state?.isIdle, true);
			assert.equal(result.state?.hasPendingMessages, false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
}

test("real Pi records cancellation at settle without starting another model turn", {
	timeout: 60_000,
}, async () => {
	const cwd = await mkdtemp(join(tmpdir(), "ask-settle-cancel-"));
	try {
		const result = await new PiIntegrationTest({
			testName: "background-settle-cancel",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd,
			isolateUserResources: true,
			rawMode: false,
			extensions: [
				fileURLToPath(
					new URL("../fixtures/settle-answer-driver.ts", import.meta.url)
				),
				fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			],
			tools: ["ask_user", "settle_probe"],
			conversation: [
				call("form", "ask_user", {
					background: true,
					questions: [
						{
							id: "cancelled",
							prompt: "Cancel this decision?",
							options: [{ value: "yes", label: "Yes" }],
						},
					],
				}),
				call("arm", "settle_probe", { phase: "settle", cancel: true }),
				assistantMessage([text("Independent work finished.")]),
			],
		}).run(
			"Queue a question and finish independent work while the user cancels."
		);
		assert.equal(result.providerRequests.length, 3);
		const snapshot = result.traceEvents
			.filter((event) => event.type === "session_snapshot")
			.at(-1);
		assert(Array.isArray(snapshot?.branch));
		const answers = snapshot.branch.filter(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === ASK_ANSWER_MESSAGE
		);
		assert.equal(answers.length, 1);
		assert.equal(answers[0].details.result.cancelled, true);
		assert.equal(result.state?.isIdle, true);
		assert.equal(result.state?.hasPendingMessages, false);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
