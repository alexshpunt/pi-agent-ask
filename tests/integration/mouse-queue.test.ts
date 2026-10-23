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
const probe = (id: string, action: string) =>
	assistantMessage(
		[toolCall({ id, name: "mouse_probe", arguments: { action } })],
		{ stopReason: "toolUse" }
	);

test("native mouse clicks answer unfocused and scrolled questions without changing ordinary input", {
	timeout: 60_000,
	skip: process.platform === "win32" && "This owned PTY resize check uses stty",
}, async () => {
	await mkdir(join(root, ".tmp"), { recursive: true });
	const workspace = await mkdtemp(join(root, ".tmp", "mouse-queue-"));
	try {
		const result = await new PiIntegrationTest({
			testName: process.env.ASK_TEST_STEREO_EXTENSION
				? "non-modal-native-mouse-stereo"
				: "non-modal-native-mouse",
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
			tuiSize: process.env.ASK_TEST_STEREO_EXTENSION
				? { cols: 184, rows: 57 }
				: { cols: 80, rows: 24 },
			conversation: [
				probe("draft", "draft"),
				assistantMessage(
					[
						toolCall({
							id: "form",
							name: "ask_user",
							arguments: {
								background: true,
								questions: [
									{
										id: "single",
										prompt: "Pick by mouse",
										options: [
											{ value: "first", label: "First choice" },
											{ value: "second", label: "Second choice" },
										],
									},
									{
										id: "multi",
										prompt: "Pick two distant choices",
										type: "multi",
										options: Array.from({ length: 15 }, (_, index) => ({
											value: String(index + 1),
											label: `Choice ${index + 1}`,
										})),
									},
								],
							},
						}),
					],
					{ stopReason: "toolUse" }
				),
				probe("drag", "drag"),
				probe("resize", "resize"),
				probe("single", "single"),
				probe("modal-focus", "modal_focus"),
				probe("editor-focus", "editor_focus"),
				probe("multi", "multi"),
				probe("submit", "submit"),
				assistantMessage([text("Mouse answers were submitted.")]),
			],
		}).run("Answer the questions through actual native terminal mouse input.");
		for (const id of [
			"drag",
			"resize",
			"single",
			"modal-focus",
			"editor-focus",
			"multi",
			"submit",
		]) {
			assert.equal(
				getToolExecution(result, id).isError,
				false,
				getToolResultText(result, id)
			);
		}
		const resized = getToolExecutionDetails(
			getToolExecution(result, "resize")
		) as { terminalSize: { cols: number; rows: number } };
		assert.deepEqual(
			resized.terminalSize,
			process.env.ASK_TEST_STEREO_EXTENSION
				? { cols: 120, rows: 40 }
				: { cols: 60, rows: 18 }
		);
		const afterSingle = getToolExecutionDetails(
			getToolExecution(result, "single")
		) as { normalInput: string; completed: unknown[] };
		assert.equal(afterSingle.normalInput, "ordinary-mouse-draft");
		assert.deepEqual(afterSingle.completed, []);
		const editorFocus = getToolExecutionDetails(
			getToolExecution(result, "editor-focus")
		) as { normalInput: string };
		assert.equal(
			editorFocus.normalInput,
			"ordinary-mouse-draft-back-to-editor"
		);
		const after = getToolExecutionDetails(
			getToolExecution(result, "submit")
		) as { normalInput: string; completed: RemoteAskCompletedEvent[] };
		assert.equal(
			after.normalInput,
			"ordinary-mouse-draft-back-to-editor-after-click"
		);
		assert.equal(after.completed.length, 1);
		assert.deepEqual(after.completed[0].result.answers.single.values, [
			"second",
		]);
		assert.deepEqual(after.completed[0].result.answers.multi.values, [
			"12",
			"13",
		]);
		assert(result.tuiRenderedOutput.includes("Mouse answers were submitted"));
		if (process.env.ASK_TEST_STEREO_EXTENSION) {
			assert(result.terminalOutput.includes("Conversation"));
			assert(result.terminalOutput.includes("Activity"));
		}
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
