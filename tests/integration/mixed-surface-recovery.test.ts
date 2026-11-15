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
import type { AskResult } from "../../src/types.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

for (const backgroundFirst of [true, false]) {
	test(`mixed foreground/background recovery preserves keyboard ownership: backgroundFirst=${backgroundFirst}`, {
		timeout: 60_000,
	}, async () => {
		await mkdir(join(root, ".tmp"), { recursive: true });
		const workspace = await mkdtemp(join(root, ".tmp", "mixed-recovery-"));
		try {
			const result = await new PiIntegrationTest({
				testName: `mixed-recovery-${backgroundFirst ? "background-first" : "foreground-first"}`,
				artifactsDir: testArtifactsDir(import.meta.filename),
				cwd: workspace,
				isolateUserResources: true,
				extensions: [
					join(root, "tests/fixtures/mixed-surface-recovery-driver.ts"),
				],
				tools: ["ask_user", "mixed_recovery_probe"],
				rawMode: false,
				tuiSize: { cols: 80, rows: 24 },
				conversation: [
					assistantMessage(
						[
							toolCall({
								id: "recover",
								name: "mixed_recovery_probe",
								arguments: { backgroundFirst },
								chunks: { kind: "fixed", size: Number.MAX_SAFE_INTEGER },
							}),
						],
						{ stopReason: "toolUse" }
					),
					assistantMessage([
						text("Recovery keyboard verification complete.", {
							chunks: { kind: "fixed", size: Number.MAX_SAFE_INTEGER },
						}),
					]),
				],
			}).run(
				"Restore mixed question requests and answer them with the keyboard."
			);
			const execution = getToolExecution(result, "recover");
			assert.equal(
				execution.isError,
				false,
				getToolResultText(result, "recover")
			);
			const details = getToolExecutionDetails(execution) as {
				started: string[];
				completed: AskResult[];
				pending: number;
			};
			assert.deepEqual(
				details.started,
				backgroundFirst
					? ["background-recovered", "foreground-recovered"]
					: ["foreground-recovered", "background-recovered"]
			);
			assert.equal(details.pending, 0);
			assert.equal(details.completed.length, 2);
			for (const title of details.started) {
				const answer = details.completed.find((item) => item.title === title);
				assert(answer);
				assert.equal(answer.cancelled, false);
				assert.equal(answer.answers[title].customText, `${title}-typed`);
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
}
