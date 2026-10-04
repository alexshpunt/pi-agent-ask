import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	getToolExecutions,
	getToolResultText,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";

async function runScenario(
	scenario: string,
	background = false,
	transport: "rpc" | "tui" = "rpc"
) {
	const root = fileURLToPath(new URL("../../.tmp/", import.meta.url));
	await mkdir(root, { recursive: true });
	const cwd = await mkdtemp(join(root, "external-ui-"));
	const cancelled = scenario === "cancel" || scenario === "abort";
	try {
		return await new PiIntegrationTest({
			testName: `external-ui-${transport}-${scenario}${background ? "-background" : ""}`,
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd,
			isolateUserResources: true,
			transport,
			rawMode: false,
			extensions: [
				fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
				fileURLToPath(
					new URL("../fixtures/external-ui-driver.ts", import.meta.url)
				),
			],
			tools: ["ask_user", "external_ui_stats"],
			conversation: [
				assistantMessage(
					[
						toolCall({
							id: "form",
							name: "ask_user",
							arguments: {
								title: scenario,
								background,
								questions: [
									{
										id: "color",
										prompt: "Choose a color",
										options: [
											{ value: "red", label: "Red" },
											{ value: "blue", label: "Blue" },
										],
									},
								],
							},
						}),
					],
					{ stopReason: "toolUse" }
				),
				...(cancelled
					? []
					: [
							assistantMessage(
								[
									toolCall({
										id: "stats",
										name: "external_ui_stats",
										arguments: {},
									}),
								],
								{ stopReason: "toolUse" }
							),
							assistantMessage([text("Continued after the result")]),
						]),
			],
		}).run("Ask the user to choose a color.");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

test("real TUI Pi still opens its native surface and ignores the offered external UI", {
	timeout: 60_000,
}, async () => {
	const result = await runScenario("answer", false, "tui");
	const details = getToolExecutionDetails(
		getToolExecution(result, "form")
	) as FormResult;
	assert.equal(details.cancelled, false);
	assert.deepEqual(details.answers.color.values, ["blue"]);
	const stats = getToolExecutionDetails(
		getToolExecution(result, "stats")
	) as LifecycleStats;
	assert.equal(stats.opened, false);
});
interface FormResult {
	answers: Record<
		string,
		{ indices: number[]; labels: string[]; values: string[] }
	>;
	cancelled: boolean;
}
interface LifecycleStats {
	closed: boolean;
	opened: boolean;
	pendingBeforeResponse: boolean;
}

test("real RPC Pi waits for the connected external UI and resumes with its answer", {
	timeout: 60_000,
}, async () => {
	const result = await runScenario("answer");
	const execution = getToolExecution(result, "form");
	assert.equal(execution.isError, false);
	const details = getToolExecutionDetails(execution) as FormResult;
	assert.equal(details.cancelled, false);
	assert.deepEqual(details.answers.color.values, ["blue"]);
	assert.deepEqual(details.answers.color.labels, ["Blue"]);
	assert.deepEqual(details.answers.color.indices, [2]);
	const stats = getToolExecutionDetails(
		getToolExecution(result, "stats")
	) as LifecycleStats;
	assert.deepEqual(stats, {
		opened: true,
		closed: true,
		pendingBeforeResponse: true,
	});
	assert.equal(
		getToolExecutions(result).filter((call) => call.toolCallId === "form")
			.length,
		1
	);
	assert.equal(result.providerRequests.length, 3);
});

for (const scenario of ["invalid-id", "invalid-value", "failure"]) {
	test(`real RPC Pi reports ${scenario} as a tool error, never an answer`, {
		timeout: 60_000,
	}, async () => {
		const result = await runScenario(scenario);
		assert.equal(getToolExecution(result, "form").isError, true);
		assert(
			getToolResultText(result, "form").includes(
				scenario === "failure" ? "disconnected" : "invalid response"
			)
		);
		const stats = getToolExecutionDetails(
			getToolExecution(result, "stats")
		) as LifecycleStats;
		assert.equal(stats.closed, true);
		assert.equal(stats.pendingBeforeResponse, true);
	});
}

for (const scenario of ["cancel", "abort"]) {
	test(`real RPC Pi ${scenario} ends the waiting call without a follow-up turn`, {
		timeout: 60_000,
	}, async () => {
		const result = await runScenario(scenario);
		const details = getToolExecutionDetails(
			getToolExecution(result, "form")
		) as FormResult;
		assert.equal(details.cancelled, true);
		assert.deepEqual(details.answers, {});
		assert.equal(result.providerRequests.length, 1);
	});
}

for (const background of [false, true]) {
	test(`unconnected real RPC Pi keeps the ${background ? "background" : "foreground"} fallback`, {
		timeout: 60_000,
	}, async () => {
		const result = await runScenario("unconnected", background);
		const details = getToolExecutionDetails(
			getToolExecution(result, "form")
		) as FormResult;
		assert.equal(details.cancelled, true);
		assert.deepEqual(details.answers, {});
		assert(
			getToolResultText(result, "form").includes(
				"requires interactive TUI mode"
			)
		);
		const stats = getToolExecutionDetails(
			getToolExecution(result, "stats")
		) as LifecycleStats;
		assert.equal(stats.opened, false);
	});
}

test("connected real RPC Pi does not claim headless background questions", {
	timeout: 60_000,
}, async () => {
	const result = await runScenario("answer", true);
	const details = getToolExecutionDetails(
		getToolExecution(result, "form")
	) as FormResult;
	assert.equal(details.cancelled, true);
	const stats = getToolExecutionDetails(
		getToolExecution(result, "stats")
	) as LifecycleStats;
	assert.equal(stats.opened, false);
});
