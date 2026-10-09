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

const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});

test("recovered background forms stay visible after the loading screen restores the editor", {
	timeout: 60_000,
}, async () => {
	const result = await new PiIntegrationTest({
		testName: "background-recovery-editor",
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: fileURLToPath(new URL("../../", import.meta.url)),
		isolateUserResources: true,
		extensions: [
			fileURLToPath(
				new URL("../fixtures/recovery-editor-driver.ts", import.meta.url)
			),
		],
		tools: ["ask_user", "restore_editor_probe", "wait_for_answers"],
		rawMode: false,
		conversation: [
			call("pending", "ask_user", {
				background: true,
				questions: [
					{
						id: "choice",
						prompt: "Recovered question?",
						options: [{ value: "yes", label: "Yes" }],
					},
				],
			}),
			call("restore", "restore_editor_probe", {}),
			call("wait", "wait_for_answers", {}),
			assistantMessage([text("Recovery verification complete.")]),
		],
	}).run(
		"Queue a form, recover while the editor is loading, then answer using the keyboard."
	);
	assert.equal(getToolExecution(result, "restore").isError, false);
	assert.deepEqual(
		getToolExecutionDetails(getToolExecution(result, "restore")),
		{ visible: true }
	);
	assert.equal(getToolExecution(result, "wait").isError, false);
	assert(result.tuiRenderedOutput.includes("Recovered question?"));
	assert(result.tuiRenderedOutput.includes("Yes"));
	assert(JSON.stringify(result.providerRequests).includes("Q1 [choice]: Yes"));
});
