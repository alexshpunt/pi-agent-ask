import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
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
import type { RemoteAskCompletedEvent } from "../../src/remote-ask.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("native Enter saves multi choices and custom text and advances to the next question and Review", {
	timeout: 60_000,
}, async () => {
	await mkdir(join(root, ".tmp"), { recursive: true });
	const workspace = await mkdtemp(join(root, ".tmp", "multi-confirm-"));
	try {
		const result = await new PiIntegrationTest({
			testName: process.env.ASK_TEST_STEREO_EXTENSION
				? "multi-confirm-stereo"
				: "multi-confirm",
			artifactsDir: testArtifactsDir(import.meta.filename),
			...(process.env.PI_COMMAND === undefined
				? {}
				: { piCommand: process.env.PI_COMMAND }),
			cwd: workspace,
			isolateUserResources: true,
			extensions: [
				...(process.env.ASK_TEST_STEREO_EXTENSION
					? [process.env.ASK_TEST_STEREO_EXTENSION]
					: []),
				join(root, "src/index.ts"),
				join(root, "tests/fixtures/mouse-driver.ts"),
			],
			tools: ["ask_user", "mouse_probe"],
			rawMode: false,
			tuiSize: { cols: 184, rows: 57 },
			conversation: [
				assistantMessage(
					[
						toolCall({
							id: "form",
							name: "ask_user",
							arguments: {
								background: true,
								questions: ["first", "last"].map((id) => ({
									id,
									prompt: `Pick ${id} multi`,
									type: "multi",
									options: [
										{ value: "one", label: "Choice 1" },
										{ value: "two", label: "Choice 2" },
									],
								})),
							},
						}),
					],
					{ stopReason: "toolUse" }
				),
				assistantMessage(
					[
						toolCall({
							id: "confirm",
							name: "mouse_probe",
							arguments: { action: "multi_confirm" },
						}),
					],
					{ stopReason: "toolUse" }
				),
				assistantMessage([text("Multi answers confirmed.")]),
			],
		}).run("Check native Space and Enter without opening a user demo.");
		const execution = getToolExecution(result, "confirm");
		assert.equal(
			execution.isError,
			false,
			getToolResultText(result, "confirm")
		);
		const details = getToolExecutionDetails(execution) as {
			normalInput: string;
			completed: RemoteAskCompletedEvent[];
		};
		assert.equal(details.normalInput, "");
		assert.equal(details.completed.length, 1);
		assert.equal(details.completed[0].result.cancelled, false);
		for (const id of ["first", "last"]) {
			assert.deepEqual(details.completed[0].result.answers[id].values, [
				"one",
				"Custom answer",
			]);
			assert.equal(
				details.completed[0].result.answers[id].customText,
				"Custom answer"
			);
		}
		assert(result.tuiRenderedOutput.includes("Multi answers confirmed."));
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
