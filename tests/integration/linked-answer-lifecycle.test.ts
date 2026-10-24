import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
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
import type { AskResult } from "../../src/types.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifactsDir = testArtifactsDir(import.meta.filename);

function appendCall(
	session: SessionManager,
	id: string,
	name: string,
	args: JsonObject
) {
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: args }],
		timestamp: Date.now(),
		api: "openai-responses",
		provider: "openai",
		model: "saved-test-model",
		stopReason: "toolUse",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	session.appendMessage(message);
}

function appendAnsweredBranch(session: SessionManager, prefix: string) {
	const requestId = `${prefix}-request`;
	const params = {
		background: true,
		questions: [
			{
				id: "q",
				prompt: `${prefix} saved question`,
				options: [{ value: "yes", label: `${prefix} saved answer` }],
			},
		],
	};
	appendCall(session, "shared-owner", "ask_user", params);
	session.appendCustomEntry("ask:queued", {
		version: 1,
		requestId,
		params,
		toolCallId: "shared-owner",
		parentToolCallId: "shared-owner",
		presentSingleAsMulti: false,
	});
	session.appendMessage({
		role: "toolResult",
		toolName: "ask_user",
		toolCallId: "shared-owner",
		content: [{ type: "text", text: "Saved queue receipt" }],
		details: {
			status: "queued",
			requestId,
			questionIds: ["q"],
			pendingRequests: 1,
		},
		isError: false,
		timestamp: Date.now(),
	});
	const result = {
		cancelled: false,
		questions: [
			{
				id: "q",
				label: "Q1",
				prompt: `${prefix} saved question`,
				type: "single",
			},
		],
		answers: {
			q: { values: ["yes"], labels: [`${prefix} saved answer`], indices: [1] },
		},
	} satisfies AskResult;
	const answer = { requestId, result, parentToolCallId: "shared-owner" };
	session.appendCustomEntry("ask:queue-completed", {
		...answer,
		display: true,
	});
	appendCall(session, "saved-wait", "wait_for_answers", {});
	return session.appendMessage({
		role: "toolResult",
		toolName: "wait_for_answers",
		toolCallId: "saved-wait",
		content: [{ type: "text", text: "Saved full answer" }],
		details: { status: "complete", requestIds: [requestId], results: [answer] },
		isError: false,
		timestamp: Date.now(),
	});
}

test("real resume, reload and tree navigation keep cards on the active branch without redelivery", {
	timeout: 60_000,
	skip:
		!process.env.ASK_TEST_STEREO_EXTENSION &&
		"Set ASK_TEST_STEREO_EXTENSION to an unchanged Stereo extension checkout",
}, async () => {
	const stereo = process.env.ASK_TEST_STEREO_EXTENSION;
	assert(stereo);
	await mkdir(join(root, ".tmp"), { recursive: true });
	const agent = await mkdtemp(join(root, ".tmp/linked-lifecycle-"));
	const sessions = await mkdtemp(join(root, ".tmp/linked-sessions-"));
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
				layout: "columns",
				chatHeight: 20,
				zoom: null,
				showTimestamps: false,
			})
		);
		const captureFile = join(sessions, "capture.json");
		await writeFile(captureFile, "{}");
		const session = SessionManager.create(root, sessions);
		const common = session.appendMessage({
			role: "user",
			content: "Common saved history",
			timestamp: Date.now(),
		});
		const target = appendAnsweredBranch(session, "NEW");
		session.branch(common);
		appendAnsweredBranch(session, "OLD");
		const sessionFile = session.getSessionFile();
		assert(sessionFile);
		assert(SessionManager.open(sessionFile).getEntry(target));
		assert((await readFile(sessionFile, "utf8")).includes(target));
		const result = await new PiIntegrationTest({
			testName: "linked-answer-lifecycle",
			artifactsDir,
			cwd: root,
			piCommand: join(root, "tests/fixtures/linked-answer-session-host.sh"),
			isolateUserResources: false,
			rawMode: false,
			tuiSize: { cols: 180, rows: 65 },
			timeoutMs: 45_000,
			environment: Object.fromEntries([
				["PI_CODING_AGENT_DIR", agent],
				["ASK_TEST_SESSION", sessionFile],
				["ASK_TEST_PI_BINARY", join(root, "node_modules/.bin/pi")],
				["ASK_LIFECYCLE_BRANCH", target],
				["ASK_LIFECYCLE_CAPTURE", captureFile],
			]),
			extensions: [
				join(root, "src/index.ts"),
				stereo,
				join(root, "tests/fixtures/linked-answer-lifecycle-driver.ts"),
			],
			tools: ["wait_for_answers"],
			conversation: [
				assistantMessage(
					[
						toolCall({
							id: "empty-wait",
							name: "wait_for_answers",
							arguments: {},
						}),
					],
					{ stopReason: "toolUse" }
				),
				assistantMessage([text("Lifecycle verified.")]),
			],
		}).run("/ask-linked-reload");
		assert.equal(getToolExecution(result, "empty-wait").isError, false);
		assert.deepEqual(
			(
				getToolExecutionDetails(getToolExecution(result, "empty-wait")) as {
					results: unknown[];
				}
			).results,
			[]
		);
		const snapshots = JSON.parse(await readFile(captureFile, "utf8"));
		await writeFile(
			join(artifactsDir, "linked-answer-lifecycle", "lifecycle-views.json"),
			JSON.stringify(snapshots)
		);
		for (const phase of ["resumed", "reloaded", "branched", "finished"]) {
			const prefix = ["resumed", "reloaded"].includes(phase) ? "OLD" : "NEW";
			const snapshot = snapshots[phase];
			const activity = stripTerminalSequences(
				snapshot.panes.activity.join("\n")
			);
			const chat = stripTerminalSequences(snapshot.panes.chat.join("\n"));
			assert.equal(activity.split(`→ ${prefix} saved answer`).length, 2, phase);
			assert(!chat.includes("saved answer"), phase);
			assert(
				!activity.includes(`${prefix === "OLD" ? "NEW" : "OLD"} saved answer`),
				phase
			);
			assert(
				snapshot.search.activity.some((value: string) =>
					value.includes(`→ ${prefix} saved answer`)
				),
				phase
			);
			assert.equal(snapshot.requests.length, 1, phase);
			assert.equal(snapshot.requests[0].delivered, true, phase);
			assert.equal(
				snapshot.requests[0].parentToolCallId,
				"shared-owner",
				phase
			);
		}
		const final = result.traceEvents
			.filter((event) => event.type === "session_snapshot")
			.at(-1);
		assert(Array.isArray(final?.branch));
		assert.equal(
			final.branch.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === "ask:background-answer"
			).length,
			0
		);
	} finally {
		await Promise.all(
			[agent, sessions].map((directory) =>
				rm(directory, { recursive: true, force: true })
			)
		);
	}
});
