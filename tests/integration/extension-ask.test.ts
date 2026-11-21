import assert from "node:assert/strict";
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

const root = fileURLToPath(new URL("../../", import.meta.url));
const probe = (id: string, action: string) =>
	assistantMessage(
		[toolCall({ id, name: "extension_probe", arguments: { action } })],
		{ stopReason: "toolUse" }
	);

function run(
	name: string,
	conversation: ReturnType<typeof probe>[],
	transport: "rpc" | "tui" = "tui"
) {
	return new PiIntegrationTest({
		testName: `extension-ask-${name}`,
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd: root,
		isolateUserResources: true,
		transport,
		rawMode: false,
		extensions: [
			fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			fileURLToPath(
				new URL("../fixtures/extension-ask-driver.ts", import.meta.url)
			),
		],
		tools: ["ask_user", "extension_probe"],
		conversation: [...conversation, assistantMessage([text("Done.")])],
	}).run("Queue a form for another extension and answer it.");
}

interface Receipt {
	requestId?: string;
	status: string;
}

test("another extension queues a background form and hears its answer before the agent does", {
	timeout: 60_000,
}, async () => {
	const result = await run("answer", [
		probe("enqueue", "enqueue"),
		probe("answer", "answer"),
		probe("stats", "stats"),
	]);
	const receipt = getToolExecutionDetails(
		getToolExecution(result, "enqueue")
	) as Receipt;
	assert.equal(receipt.status, "queued");
	const stats = getToolExecutionDetails(getToolExecution(result, "stats")) as {
		answerMessages: number;
		answered: Array<{
			answerMessagesBefore: number;
			owner?: string;
			requestId: string;
			result?: { answers: Record<string, { values: string[] }> };
			toolCallId?: string;
		}>;
	};
	assert.equal(stats.answered.length, 1);
	const [answered] = stats.answered;
	assert.equal(answered.requestId, receipt.requestId);
	assert.equal(answered.owner, "probe");
	assert.equal(answered.toolCallId, "enqueue");
	assert.deepEqual(answered.result?.answers.goal.values, ["confirm"]);
	assert.equal(answered.answerMessagesBefore, 0);
	assert.equal(stats.answerMessages, 1);
});

for (const quiet of [false, true]) {
	test(`${quiet ? "a quiet answer does not extend" : "a normal answer extends"} the agent's last turn`, {
		timeout: 60_000,
	}, async () => {
		const result = await run(quiet ? "quiet" : "loud", [
			probe("enqueue", "enqueue"),
			probe("arm", quiet ? "answer_next_turn_quiet" : "answer_next_turn"),
			...(quiet ? [] : [assistantMessage([text("Answer received.")])]),
		]);
		const answers = result.traceEvents
			.filter((event) => event.type === "session_snapshot")
			.at(-1) as { branch?: Array<{ type: string; customType?: string }> };
		assert.equal(
			answers.branch?.filter(
				(entry) =>
					entry.type === "custom_message" &&
					entry.customType === "ask:background-answer"
			).length,
			1
		);
		assert.equal(result.providerRequests.length, quiet ? 3 : 4);
	});
}

test("an invalid extension form is rejected with its issues and never queued", {
	timeout: 60_000,
}, async () => {
	const result = await run("invalid", [probe("enqueue", "enqueue_invalid")]);
	const receipt = getToolExecutionDetails(
		getToolExecution(result, "enqueue")
	) as Receipt & { issues: unknown[] };
	assert.equal(receipt.status, "invalid");
	assert(receipt.issues.length > 0);
});

test("a form without an owner is not accepted", {
	timeout: 60_000,
}, async () => {
	const result = await run("unowned", [probe("enqueue", "enqueue_unowned")]);
	const receipt = getToolExecutionDetails(getToolExecution(result, "enqueue"));
	assert.equal(receipt, null);
});

test("a headless Pi reports extension forms as unavailable", {
	timeout: 60_000,
}, async () => {
	const result = await run("headless", [probe("enqueue", "enqueue")], "rpc");
	const receipt = getToolExecutionDetails(
		getToolExecution(result, "enqueue")
	) as Receipt;
	assert.equal(receipt.status, "unavailable");
});
