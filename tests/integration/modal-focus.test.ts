import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import type { AskResult } from "../../src/types.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("Escape closes focused settings and leaves a newly arriving question answerable", {
	timeout: 60_000,
}, async () => {
	await mkdir(join(root, ".tmp"), { recursive: true });
	const workspace = await mkdtemp(join(root, ".tmp", "modal-focus-"));
	const agent = join(workspace, "agent");
	await mkdir(agent);
	try {
		await writeFile(
			join(agent, "settings.json"),
			JSON.stringify({
				quietStartup: true,
				tuiMode: "fullscreen",
			})
		);
		const stereo = process.env.ASK_TEST_STEREO_ENTRY;
		const piCommand = process.env.PI_COMMAND;
		const result = await new PiIntegrationTest({
			testName: stereo ? "stereo-settings-focus" : "settings-focus",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd: workspace,
			isolateUserResources: false,
			environment: Object.fromEntries([
				["PI_CODING_AGENT_DIR", agent],
				...(stereo ? [["ASK_TEST_STEREO_ENTRY", stereo]] : []),
			]),
			...(piCommand ? { piCommand } : {}),
			extensions: [
				...(stereo ? [stereo] : []),
				join(root, "src/index.ts"),
				join(root, "tests/fixtures/modal-focus-driver.ts"),
			],
			rawMode: false,
			tuiSize: { cols: 120, rows: 40 },
			tools: ["ask_user"],
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
										prompt: "Focus fixture question?",
										options: [{ value: "yes", label: "Fixture answer" }],
									},
								],
							},
						}),
					],
					{ stopReason: "toolUse" }
				),
				assistantMessage([text("Finished.")]),
			],
		}).run("Ask the question and wait for the user.");
		const details = getToolExecutionDetails(
			getToolExecution(result, "form")
		) as AskResult;
		assert.equal(details.cancelled, false);
		assert.deepEqual(details.answers.choice.values, ["yes"]);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
