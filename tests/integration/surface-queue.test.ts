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
import type { SurfaceQueueSnapshot } from "../fixtures/surface-queue-driver.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

for (const action of [
	"background_first",
	"foreground_first",
	"deferred_background",
	"background_batch",
	"reopen_during_foreground",
	"reopen_during_loading",
	"defer_during_loading",
] as const) {
	test(`concurrent question surfaces keep keyboard input working: ${action}`, {
		timeout: 60_000,
	}, async () => {
		await mkdir(join(root, ".tmp"), { recursive: true });
		const workspace = await mkdtemp(join(root, ".tmp", "surface-queue-"));
		try {
			const result = await new PiIntegrationTest({
				testName: `surface-queue-${action}`,
				...(process.env.PI_COMMAND === undefined
					? {}
					: { piCommand: process.env.PI_COMMAND }),
				artifactsDir: testArtifactsDir(import.meta.filename),
				cwd: workspace,
				isolateUserResources: true,
				extensions: [join(root, "tests/fixtures/surface-queue-driver.ts")],
				tools: ["ask_user", "surface_queue_probe"],
				rawMode: false,
				tuiSize: { cols: 80, rows: 24 },
				conversation: [
					assistantMessage(
						[
							toolCall({
								id: "exercise",
								name: "surface_queue_probe",
								arguments: { action },
								chunks: { kind: "fixed", size: Number.MAX_SAFE_INTEGER },
							}),
						],
						{ stopReason: "toolUse" }
					),
					assistantMessage([
						text("Keyboard surface verification complete.", {
							chunks: { kind: "fixed", size: Number.MAX_SAFE_INTEGER },
						}),
					]),
				],
			}).run("Answer concurrent question requests without overlapping forms.");
			const execution = getToolExecution(result, "exercise");
			assert.equal(
				execution.isError,
				false,
				getToolResultText(result, "exercise")
			);
			const details = getToolExecutionDetails(
				execution
			) as SurfaceQueueSnapshot;
			const expectedOrder =
				action === "foreground_first" || action === "defer_during_loading"
					? ["foreground", "background"]
					: ["background", "foreground"];
			if (action === "reopen_during_loading") {
				expectedOrder.splice(1, 1, "background-next");
			}
			if (action === "background_batch") {
				expectedOrder.splice(1, 0, "background-next");
			}
			assert.deepEqual(details.started, expectedOrder);
			assert.equal(details.completed.length, expectedOrder.length);
			for (const title of expectedOrder) {
				const completed = details.completed.find(
					(event) => event.result.title === title
				);
				assert(completed);
				assert.equal(completed.result.cancelled, false);
				assert.equal(
					completed.result.answers[title].customText,
					(action === "deferred_background" ||
						action === "reopen_during_foreground") &&
						title === "background"
						? "saved-custom-draft-continued"
						: `${title}-typed`
				);
			}
			if (
				action !== "deferred_background" &&
				action !== "reopen_during_foreground"
			) {
				assert.equal(
					details.normalInput,
					action === "background_first" || action === "background_batch"
						? "ordinary-surface-draft-kept"
						: "ordinary-surface-draft"
				);
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
}
