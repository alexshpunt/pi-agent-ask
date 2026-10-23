import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	PiIntegrationTest,
	testArtifactsDir,
	toolCall,
} from "pi-coding-agent-test";

test("Escape stops the agent after cancelling a foreground form", {
	timeout: 60_000,
}, async () => {
	const result = await new PiIntegrationTest({
		testName: "escape-cancel-foreground",
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: fileURLToPath(new URL("../../", import.meta.url)),
		isolateUserResources: true,
		extensions: [
			fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			fileURLToPath(new URL("../fixtures/escape-driver.ts", import.meta.url)),
		],
		tools: ["ask_user"],
		rawMode: false,
		conversation: [
			assistantMessage(
				[
					toolCall({
						id: "form",
						name: "ask_user",
						arguments: {
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
		],
	}).run("Ask the question and wait for the user.");
	assert(result.traceEvents.some((event) => event.type === "agent_settled"));
	assert.equal(result.providerRequests.length, 1);
});
