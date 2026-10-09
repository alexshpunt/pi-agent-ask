import assert from "node:assert/strict";
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

// Protects the public command surface through the real extension loader.
test("real Pi exposes agent question tools without answer or replay commands", {
	timeout: 60_000,
}, async () => {
	const result = await new PiIntegrationTest({
		testName: "agent-question-surface",
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: fileURLToPath(new URL("../../", import.meta.url)),
		isolateUserResources: true,
		extensions: [
			fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			fileURLToPath(
				new URL("../fixtures/tool-surface-driver.ts", import.meta.url)
			),
		],
		tools: ["inspect_ask_surface"],
		conversation: [
			assistantMessage(
				[
					toolCall({
						id: "surface",
						name: "inspect_ask_surface",
						arguments: {},
					}),
				],
				{ stopReason: "toolUse" }
			),
			assistantMessage([text("Question tool surface checked.")]),
		],
	}).run("Read the registered ask surface.");
	const execution = getToolExecution(result, "surface");
	assert.equal(execution.isError, false);
	const details = getToolExecutionDetails(execution) as {
		commands: string[];
		tools: string[];
	};
	assert(details.commands.includes("ask-settings"));
	for (const removed of ["answer", "answer:again", "ask:replay"]) {
		assert(
			!details.commands.includes(removed),
			`${removed} must not be registered`
		);
	}
	for (const tool of [
		"ask_user",
		"wait_for_answers",
		"list_ask_history",
		"read_ask_history",
		"export_ask_history",
	]) {
		assert(details.tools.includes(tool), tool);
	}
});
