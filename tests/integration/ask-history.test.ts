import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";
import { readAskHistory } from "../../src/ask-history.ts";
import type { HistoryRecord } from "../../src/ask-history-schema.ts";

const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});
const form = (background: boolean) => ({
	title: background ? "Background form" : "Foreground form",
	background,
	questions: [
		{
			id: "scope",
			prompt: "Choose scope",
			type: "multi",
			options: [
				{ value: "small", label: "Small", description: "Small description" },
			],
		},
		{
			id: "preview",
			prompt: "Choose preview",
			type: "preview",
			options: [
				{ value: "doc", label: "Document", previewFile: "preview.txt" },
			],
		},
	],
});

// Protects real extension loading, foreground/background capture, native invisible rows, and file export.
test("real Pi records both ask paths and silently reads and exports exact history", {
	timeout: 60_000,
}, async () => {
	const tmp = fileURLToPath(new URL("../../.tmp/", import.meta.url));
	await mkdir(tmp, { recursive: true });
	const cwd = await mkdtemp(join(tmp, "history-integration-"));
	try {
		await writeFile(join(cwd, "preview.txt"), "Saved preview\nSecond line");
		const result = await new PiIntegrationTest({
			testName: "ask-history-native",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd,
			isolateUserResources: true,
			rawMode: false,
			extensions: [
				fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
				fileURLToPath(
					new URL("../fixtures/history-driver.ts", import.meta.url)
				),
			],
			tools: [
				"ask_user",
				"wait_for_answers",
				"list_ask_history",
				"read_ask_history",
				"export_ask_history",
			],
			conversation: [
				call("foreground", "ask_user", form(false)),
				call("background", "ask_user", form(true)),
				call("waiting", "list_ask_history", {}),
				call("page", "list_ask_history", { limit: 1 }),
				call("read", "read_ask_history", {
					requestId: "foreground",
					questionId: "scope",
				}),
				call("wait", "wait_for_answers", {}),
				call("answered", "list_ask_history", {
					answeredOnly: true,
					query: "scope",
				}),
				call("export", "export_ask_history", {
					path: "selected.md",
					keys: [
						{ requestId: "foreground", questionId: "scope" },
						{ requestId: "background", questionId: "preview" },
					],
				}),
				call("missing", "read_ask_history", {
					requestId: "absent",
					questionId: "scope",
				}),
				call("bad-export", "export_ask_history", {
					path: "must-not-exist.md",
					keys: [
						{ requestId: "foreground", questionId: "scope" },
						{ requestId: "absent", questionId: "scope" },
					],
				}),
				call("existing", "export_ask_history", { path: "selected.md" }),
				assistantMessage([text("History verification complete.")]),
			],
		}).run("Verify the session question journal.");
		for (const id of [
			"foreground",
			"background",
			"waiting",
			"page",
			"read",
			"wait",
			"answered",
			"export",
		]) {
			assert.equal(getToolExecution(result, id).isError, false, id);
		}
		for (const id of ["missing", "bad-export", "existing"]) {
			assert.equal(getToolExecution(result, id).isError, true, id);
		}
		const details = (id: string) =>
			getToolExecutionDetails(getToolExecution(result, id));
		const waiting = details("waiting") as {
			total: number;
			records: Array<{ requestId: string; status: string }>;
		};
		assert.equal(waiting.total, 4);
		assert.deepEqual(
			waiting.records.map((record) => record.status),
			["answered", "answered", "waiting", "waiting"]
		);
		const page = details("page") as {
			total: number;
			records: unknown[];
			nextOffset: number;
		};
		assert.equal(page.records.length, 1);
		assert.equal(page.nextOffset, 1);
		assert.equal(page.total, 4);
		const record = (details("read") as { record: HistoryRecord }).record;
		assert.deepEqual(record.answer?.values, ["small", "Custom choice"]);
		assert.equal(record.answer?.customText, "Custom choice");
		assert.equal(record.answer?.note, "Question note");
		assert.deepEqual(record.answer?.optionNotes, { small: "Option note" });
		assert.equal((details("answered") as { total: number }).total, 2);
		const exported = details("export") as {
			path: string;
			keys: Array<{ requestId: string; questionId: string }>;
		};
		assert(result.state);
		assert.equal(exported.path, join(result.state.cwd, "selected.md"));
		assert.equal(exported.keys.length, 2);
		assert.notEqual(exported.keys[0].requestId, exported.keys[1].requestId);
		const content = await readFile(join(cwd, "selected.md"), "utf8");
		for (const value of [
			"Choose scope",
			"Small description",
			"Custom choice",
			"Question note",
			"Option note",
			"Saved preview\nSecond line",
		]) {
			assert(content.includes(value), value);
		}
		await assert.rejects(readFile(join(cwd, "must-not-exist.md")), {
			code: "ENOENT",
		});
		assert.equal(await readFile(join(cwd, "selected.md"), "utf8"), content);
		for (const name of [
			"list_ask_history",
			"read_ask_history",
			"export_ask_history",
			"Question not found on the current branch",
		]) {
			assert(!result.tuiRenderedOutput.includes(name), name);
		}
		assert(result.tuiRenderedOutput.includes("History verification complete"));
		assert(result.tuiRenderedOutput.includes("Choose scope"));
		const snapshot = result.traceEvents
			.filter((event) => event.type === "session_snapshot")
			.at(-1);
		assert(Array.isArray(snapshot?.branch));
		const persisted = SessionManager.inMemory(cwd, undefined, [
			{
				type: "session",
				id: result.state?.sessionId ?? "history",
				timestamp: new Date().toISOString(),
				cwd,
				version: 3,
			},
			...snapshot.branch,
		]);
		const records = readAskHistory(persisted.getBranch());
		assert.equal(records.length, 4);
		assert(records.every((item) => item.status === "answered"));
		persisted.appendCompaction(
			"Compacted without any answers",
			persisted.getLeafId(),
			10_000
		);
		assert.deepEqual(readAskHistory(persisted.getBranch()), records);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
