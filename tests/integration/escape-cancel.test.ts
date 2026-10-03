import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	PiIntegrationTest,
	testArtifactsDir,
	toolCall,
} from "pi-coding-agent-test";

for (const background of [false, true]) {
	test(`Escape stops the agent after cancelling a ${background ? "background" : "foreground"} form`, {
		timeout: 60_000,
	}, async () => {
		const result = await new PiIntegrationTest({
			testName: `escape-cancel-${background ? "background" : "foreground"}`,
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd: fileURLToPath(new URL("../../", import.meta.url)),
			isolateUserResources: true,
			extensions: [
				fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
				fileURLToPath(new URL("../fixtures/escape-driver.ts", import.meta.url)),
			],
			tools: ["ask_user", "wait_for_answers"],
			rawMode: false,
			conversation: [
				assistantMessage(
					[
						toolCall({
							id: "form",
							name: "ask_user",
							arguments: {
								background,
								questions: [
									{
										id: "choice",
										prompt: "Choose?",
										options: [{ value: "yes", label: "Yes" }],
									},
								],
							},
						}),
					],
					{ stopReason: "toolUse" }
				),
				...(background
					? [
							assistantMessage(
								[
									toolCall({
										id: "wait",
										name: "wait_for_answers",
										arguments: {},
									}),
								],
								{ stopReason: "toolUse" }
							),
						]
					: []),
			],
		}).run("Ask the question and wait for the user.");
		assert(result.traceEvents.some((event) => event.type === "agent_settled"));
		assert.equal(result.providerRequests.length, background ? 2 : 1);
	});
}
