import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifactsDir = testArtifactsDir(import.meta.filename);
const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});

for (const layout of ["columns", "rows"]) {
	test(`real Ask links automatic and waited answers to distinct direct/nested owners in ${layout}`, {
		timeout: 60_000,
		skip:
			!process.env.ASK_TEST_STEREO_EXTENSION &&
			"Set ASK_TEST_STEREO_EXTENSION to an unchanged Stereo extension checkout",
	}, async () => {
		await mkdir(join(root, ".tmp"), { recursive: true });
		const agent = await mkdtemp(join(root, ".tmp/linked-agent-"));
		const captureFile = join(agent, "capture.json");
		const stereo = process.env.ASK_TEST_STEREO_EXTENSION;
		assert(stereo);
		try {
			await writeFile(
				join(agent, "settings.json"),
				JSON.stringify({ quietStartup: true })
			);
			await writeFile(
				join(agent, "transcript.json"),
				JSON.stringify({
					mode: "split",
					side: "left",
					chatWidth: 60,
					layout,
					chatHeight: 20,
					zoom: null,
					showTimestamps: false,
				})
			);
			const result = await new PiIntegrationTest({
				testName: `linked-answers-${layout}`,
				artifactsDir,
				cwd: root,
				isolateUserResources: false,
				rawMode: false,
				tuiSize: { cols: 180, rows: 65 },
				environment: Object.fromEntries([
					["PI_CODING_AGENT_DIR", agent],
					["ASK_LINKED_CAPTURE", captureFile],
				]),
				extensions: [
					join(root, "src/index.ts"),
					stereo,
					join(root, "tests/fixtures/linked-answer-driver.ts"),
				],
				tools: [
					"ask_user",
					"wait_for_answers",
					"queue_probe",
					"nested_question",
				],
				conversation: [
					call("direct-owner", "ask_user", {
						background: true,
						title: "direct",
						questions: [
							{
								id: "direct",
								prompt: "Choose direct?",
								options: [{ value: "yes", label: "Yes direct" }],
							},
						],
					}),
					call("outer-owner", "nested_question", { id: "nested" }),
					call("independent", "queue_probe", { action: "research" }),
					call("wait", "wait_for_answers", {}),
					call("second-wait", "wait_for_answers", {}),
					assistantMessage([text("Linked answers finished.")]),
				],
			}).run(
				"Queue independent forms, research, then consume remaining answers."
			);
			for (const id of ["direct-owner", "outer-owner", "wait", "second-wait"]) {
				assert.equal(getToolExecution(result, id).isError, false);
			}
			const wait = getToolExecutionDetails(
				getToolExecution(result, "wait")
			) as { results: Array<{ parentToolCallId?: string }> };
			assert.deepEqual(
				wait.results.map((answer) => answer.parentToolCallId),
				["outer-owner"]
			);
			assert.deepEqual(
				(
					getToolExecutionDetails(getToolExecution(result, "second-wait")) as {
						results: unknown[];
					}
				).results,
				[]
			);
			const snapshot = result.traceEvents
				.filter((event) => event.type === "session_snapshot")
				.at(-1);
			assert(Array.isArray(snapshot?.branch));
			const cards = snapshot.branch.filter(
				(entry) =>
					entry.type === "custom" && entry.customType === "ask:queue-completed"
			);
			assert.deepEqual(
				cards.map(
					(entry) =>
						(entry.data as { parentToolCallId: string }).parentToolCallId
				),
				["direct-owner", "outer-owner"]
			);
			const messages = snapshot.branch.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === "ask:background-answer"
			);
			assert.equal(messages.length, 1);
			assert.equal(messages[0].display, false);
			const capture = JSON.parse(await readFile(captureFile, "utf8"));
			const activity = stripTerminalSequences(
				capture.panes.activity.join("\n")
			);
			const chat = stripTerminalSequences(capture.panes.chat.join("\n"));
			for (const id of ["direct", "nested"]) {
				assert.equal(activity.split(`→ Yes ${id}`).length, 2, activity);
				assert(!chat.includes(`Yes ${id}`));
				assert(
					capture.search.activity.some((value: string) =>
						value.includes(`→ Yes ${id}`)
					)
				);
			}
			assert(
				activity.indexOf("Choose direct?") <
					activity.indexOf("Nested receipt nested")
			);
			assert(
				activity.indexOf("Nested receipt nested") <
					activity.indexOf("Choose nested?")
			);
			assert(activity.includes("Consumed 1 background answer(s)"));
			const finalRequest = JSON.stringify(
				result.providerRequests.at(-1)?.messages
			);
			for (const id of ["direct", "nested"]) {
				assert.equal(finalRequest.split(`Q1 [${id}]: Yes ${id}`).length, 2, id);
			}
			await writeFile(
				join(artifactsDir, `linked-answers-${layout}`, "linked-views.json"),
				JSON.stringify(capture)
			);
			assert(
				JSON.stringify(result.providerRequests).includes(
					"Q1 [direct]: Yes direct"
				)
			);
			assert(
				JSON.stringify(result.providerRequests).includes(
					"Q1 [nested]: Yes nested"
				)
			);
		} finally {
			await rm(agent, { recursive: true, force: true });
		}
	});
}
