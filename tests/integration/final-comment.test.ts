import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	getToolResultText,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const form = {
	questions: [
		{ id: "q", prompt: "Choose?", options: [{ value: "yes", label: "Yes" }] },
	],
};
const call = (id: string) =>
	assistantMessage([toolCall({ id, name: "ask_user", arguments: form })], {
		stopReason: "toolUse",
	});

test("real Pi delivers final comments on submission and cancellation", {
	timeout: 60_000,
}, async () => {
	const result = await new PiIntegrationTest({
		testName: "final-action-comments",
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: root,
		isolateUserResources: true,
		extensions: [
			fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			fileURLToPath(
				new URL("../fixtures/final-comment-driver.ts", import.meta.url)
			),
		],
		tools: ["ask_user"],
		rawMode: false,
		conversation: [
			call("submit"),
			call("cancel"),
			assistantMessage([text("Finished.")]),
		],
	}).run("Ask twice.");
	for (const [id, comment, cancelled] of [
		["submit", "ready for review", false],
		["cancel", "declined for revision", true],
	] as const) {
		const details = getToolExecutionDetails(getToolExecution(result, id)) as {
			comment?: string;
			cancelled: boolean;
		};
		assert.equal(details.cancelled, cancelled);
		assert.equal(details.comment, comment);
		assert.ok(getToolResultText(result, id).includes(comment));
	}
	assert.equal(result.providerRequests.length, 3);
});
