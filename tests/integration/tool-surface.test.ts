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

// Protects default tool exposure and prompt contributions through the real extension loader.
test("real Pi exposes question tools without default history tools or prompt rules", {
	timeout: 60_000,
}, async () => {
	const cwd = await mkdtemp(join(tmpdir(), "ask-tool-surface-"));
	try {
		const result = await new PiIntegrationTest({
			testName: "agent-question-surface",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd,
			isolateUserResources: true,
			extensions: [
				fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
				fileURLToPath(
					new URL("../fixtures/tool-surface-driver.ts", import.meta.url)
				),
			],
			tools: ["ask_user", "wait_for_answers", "inspect_ask_surface"],
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
			toolGuidelines: Record<string, string[]>;
			tools: string[];
		};
		assert(details.commands.includes("ask-settings"));
		for (const removed of ["answer", "answer:again", "ask:replay"]) {
			assert(
				!details.commands.includes(removed),
				`${removed} must not be registered`
			);
		}
		for (const tool of ["ask_user", "wait_for_answers"]) {
			assert(details.tools.includes(tool), tool);
		}
		for (const tool of [
			"list_ask_history",
			"read_ask_history",
			"export_ask_history",
		]) {
			assert(!details.tools.includes(tool), `${tool} must be opt-in`);
		}
		for (const tool of ["ask_user", "wait_for_answers"]) {
			assert.deepEqual(details.toolGuidelines[tool] ?? [], [], tool);
		}
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
