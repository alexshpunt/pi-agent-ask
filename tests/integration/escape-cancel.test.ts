import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolResultText,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

for (const background of [false, true]) {
	test(`Escape cancels a ${background ? "background form without stopping work" : "foreground form and stops the agent"}`, {
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
			tools: ["ask_user", "wait_for_answers", "bash"],
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
							assistantMessage(
								[
									toolCall({
										id: "work",
										name: "bash",
										arguments: {
											command: "printf 'independent work completed\\n'",
										},
									}),
								],
								{ stopReason: "toolUse" }
							),
							assistantMessage([text("Finished independent work.")]),
						]
					: []),
			],
		}).run("Ask the question and wait for the user.");
		assert(result.traceEvents.some((event) => event.type === "agent_settled"));
		assert.equal(result.providerRequests.length, background ? 4 : 1);
		if (background) {
			assert.equal(getToolExecution(result, "work").isError, false);
			assert(
				getToolResultText(result, "work").includes("independent work completed")
			);
		}
	});
}
