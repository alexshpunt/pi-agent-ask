import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";
import { registerAskTool } from "../src/ask-tool.ts";
import { AskOptionSchema, AskParamsSchema } from "../src/schema.ts";
import type { AskParams } from "../src/types.ts";

const NON_INTERACTIVE_MESSAGE_RE =
	/Needs user input: ask_user requires interactive TUI mode\./;
const FIRST_QUESTION_RE = /1\. Goal: What should I optimize for\?/;
const SPEED_OPTION_RE = /- Speed \[speed\]/;
const CUSTOM_OPTION_RE = /- Type your own \[custom\]/;
const DUPLICATE_ID_RE =
	/questions\[1\]\.id: Question 2: duplicate question id "scope"/;
const MISSING_OPTION_VALUE_RE =
	/questions\[0\]\.options\[0\]\.value: Question 1, option 1: value is required/;
const EMPTY_QUESTIONS_RE = /questions: At least one question is required/;
const INVALID_TYPE_RE =
	/questions\[0\]\.type: Question 1: invalid type "grid"; expected "single" or "multi"/;
const UI_FAILED_RE = /UI failed/;
const HAS_UI = "hasUI";
const noop = () => {
	// intentional test callback
};

function registerMockTool() {
	const tools: Record<string, unknown>[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const events: Array<{ channel: string; data: unknown }> = [];
	registerAskTool({
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
		registerTool(tool: unknown) {
			tools.push(tool as Record<string, unknown>);
		},
		events: {
			emit(channel: string, data: unknown) {
				events.push({ channel, data });
			},
		},
	} as never);
	return {
		entries,
		events,
		tool: tools[0] as {
			execute: (...args: any[]) => Promise<any>;
			outputSchema: Record<string, any>;
			parameters: Record<string, any>;
			prepareArguments: (args: unknown) => unknown;
			renderCall: (args: unknown, theme: any) => { text: string };
			renderResult: (
				result: any,
				options: unknown,
				theme: any
			) => { text: string };
		},
	};
}

function makeCtx(hasUi: boolean, mode = hasUi ? "tui" : "print"): unknown {
	return { [HAS_UI]: hasUi, mode };
}

test("ask tool saves file context text for replay and keeps option labels", async () => {
	const { entries, tool } = registerMockTool();
	const params: AskParams = {
		questions: [
			{
				id: "file",
				prompt: "Accept this document?",
				context: fileURLToPath(
					new URL("fixtures/context.txt", import.meta.url)
				),
				options: [{ value: "accept", label: "Accept" }],
			},
		],
	};
	assert.equal(Value.Check(AskParamsSchema, params), true);
	const result = await tool.execute("file-call", params, undefined, noop, {
		mode: "print",
		cwd: process.cwd(),
	});
	assert.equal(result.details.error, undefined);
	const saved = (entries[0].data as { params: AskParams }).params.questions[0];
	assert(saved.context?.includes("Context loaded from a local file"));
	assert.equal(saved.options[0].label, "Accept");
});

test("ask tool rejects unreadable context files before UI and payload storage", async () => {
	const { entries, events, tool } = registerMockTool();
	let uiOpened = false;
	const result = await tool.execute(
		"missing-file",
		{
			questions: [
				{
					id: "file",
					prompt: "Accept this document?",
					context: fileURLToPath(
						new URL("fixtures/missing.txt", import.meta.url)
					),
					options: [{ value: "accept", label: "Accept" }],
				},
			],
		},
		undefined,
		noop,
		{
			mode: "tui",
			cwd: process.cwd(),
			ui: {
				custom() {
					uiOpened = true;
				},
			},
		}
	);
	assert.equal(result.details.error.kind, "invalid_input");
	assert(result.content[0].text.includes("Cannot load context file"));
	assert.equal(uiOpened, false);
	assert.deepEqual(entries, []);
	assert.deepEqual(events, []);
});
test("ask tool declares an output schema and returns structured pending results", async () => {
	const { tool } = registerMockTool();
	assert(tool.outputSchema);
	const result = await tool.execute(
		"structured-pending",
		sampleParams(),
		undefined,
		noop,
		makeCtx(false)
	);
	assert.deepEqual(result.structuredContent, {
		requestId: result.details.requestId,
		cancelled: true,
		answers: {},
	});
	assert.equal(Value.Check(tool.outputSchema, result.structuredContent), true);
});

test("invalid ask input returns the same structured error as its details", async () => {
	const { tool } = registerMockTool();
	const result = await tool.execute(
		"structured-error",
		{ questions: [] },
		undefined,
		noop,
		makeCtx(false)
	);
	assert.deepEqual(result.structuredContent, {
		cancelled: true,
		answers: {},
		error: { issues: result.details.error.issues },
	});
	assert.equal(Value.Check(tool.outputSchema, result.structuredContent), true);
});
function sampleParams(): AskParams {
	return {
		title: "Clarify next step",
		questions: [
			{
				id: "goal",
				label: "Goal",
				prompt: "What should I optimize for?",
				options: [
					{ value: "speed", label: "Speed" },
					{ value: "safety", label: "Safety" },
				],
			},
		],
	};
}

test("ask option schema supports recommendations", () => {
	assert.equal(
		Value.Check(AskOptionSchema, {
			value: "small",
			label: "Small",
			description: "Lowest implementation risk",
			recommended: true,
		}),
		true
	);
});

test("ask params schema still accepts the removed question required flag", () => {
	assert.equal(
		Value.Check(AskParamsSchema, {
			questions: [
				{
					id: "scope",
					prompt: "Choose a scope",
					required: true,
					options: [{ value: "small", label: "Small" }],
				},
			],
		}),
		true
	);
});

test("ask params schema constrains question types", () => {
	assert.equal(
		Value.Check(AskParamsSchema, {
			questions: [
				{
					id: "layout",
					prompt: "Choose a layout",
					type: "grid",
					options: [{ value: "compact", label: "Compact" }],
				},
			],
		}),
		false
	);
});

test("ask tool stores valid payloads as soon as they are called", async () => {
	const { entries, tool } = registerMockTool();
	const params = sampleParams();

	await tool.execute("call-1", params, undefined, noop, makeCtx(false));

	assert.deepEqual(
		entries.map((entry) => entry.customType),
		["ask:payload", "ask:history-request", "ask:history-completed"]
	);
	assert.deepEqual(entries[0].data, {
		version: 1,
		source: "tool",
		params,
		sourceEntryId: "call-1",
		timestamp: (entries[0].data as { timestamp: number }).timestamp,
	});
});

test("ask tool returns pending questions in non-interactive mode", async () => {
	const { tool } = registerMockTool();

	const result = await tool.execute(
		"call-1",
		sampleParams(),
		undefined,
		noop,
		makeCtx(false)
	);

	assert.equal(result.details.cancelled, true);
	assert.deepEqual(result.details.questions, [
		{
			id: "goal",
			label: "Goal",
			prompt: "What should I optimize for?",
			type: "single",
		},
	]);
	assert.deepEqual(result.details.answers, {});
	assert.match(result.content[0].text, NON_INTERACTIVE_MESSAGE_RE);
	assert.match(result.content[0].text, FIRST_QUESTION_RE);
	assert.match(result.content[0].text, SPEED_OPTION_RE);
	assert.match(result.content[0].text, CUSTOM_OPTION_RE);
});

test("ask tool does not open custom UI outside TUI mode", async () => {
	const { tool } = registerMockTool();
	let customOpened = false;

	const result = await tool.execute("call-1", sampleParams(), undefined, noop, {
		[HAS_UI]: true,
		mode: "rpc",
		ui: {
			custom() {
				customOpened = true;
			},
		},
	});

	assert.equal(customOpened, false);
	assert.equal(result.details.cancelled, true);
	assert.match(result.content[0].text, NON_INTERACTIVE_MESSAGE_RE);
});

test("emits Herdr blocked lifecycle around an interactive ask", async () => {
	const { events, tool } = registerMockTool();
	const result = await tool.execute("call-1", sampleParams(), undefined, noop, {
		[HAS_UI]: true,
		mode: "tui",
		ui: {
			custom: async () => ({
				answers: {
					goal: { values: ["speed"], labels: ["Speed"], indices: [1] },
				},
				cancelled: false,
				mode: "submit",
				questions: [
					{
						id: "goal",
						label: "Goal",
						prompt: "What should I optimize for?",
						type: "single",
					},
				],
				title: "Clarify next step",
			}),
			setWorkingVisible: noop,
		},
	});

	assert.equal(result.details.cancelled, false);
	assert.deepEqual(
		events.filter(({ channel }) => channel === "herdr:blocked"),
		[
			{
				channel: "herdr:blocked",
				data: { active: true, label: "Waiting for user response" },
			},
			{ channel: "herdr:blocked", data: { active: false } },
		]
	);
});

test("clears Herdr blocked lifecycle when an ask is cancelled", async () => {
	const { events, tool } = registerMockTool();
	const result = await tool.execute("call-1", sampleParams(), undefined, noop, {
		[HAS_UI]: true,
		mode: "tui",
		ui: {
			custom: async () => ({
				answers: {},
				cancelled: true,
				mode: "submit",
				questions: [
					{
						id: "goal",
						label: "Goal",
						prompt: "What should I optimize for?",
						type: "single",
					},
				],
				title: "Clarify next step",
			}),
			setWorkingVisible: noop,
		},
	});

	assert.equal(result.details.cancelled, true);
	assert.deepEqual(
		events
			.filter(({ channel }) => channel === "herdr:blocked")
			.map(({ data }) => data),
		[{ active: true, label: "Waiting for user response" }, { active: false }]
	);
});

test("clears Herdr blocked lifecycle when custom UI rejects", async () => {
	const { events, tool } = registerMockTool();
	await assert.rejects(
		tool.execute("call-1", sampleParams(), undefined, noop, {
			[HAS_UI]: true,
			mode: "tui",
			ui: {
				custom: () => Promise.reject(new Error("UI failed")),
				setWorkingVisible: noop,
			},
		}),
		UI_FAILED_RE
	);

	assert.deepEqual(
		events
			.filter(({ channel }) => channel === "herdr:blocked")
			.map(({ data }) => data),
		[{ active: true, label: "Waiting for user response" }, { active: false }]
	);
});

test("does not emit Herdr blocked state outside TUI mode", async () => {
	const { events, tool } = registerMockTool();
	await tool.execute("call-1", sampleParams(), undefined, noop, makeCtx(false));
	assert.deepEqual(
		events.filter(({ channel }) => channel === "herdr:blocked"),
		[]
	);
});

test("ask tool includes custom answer fallback for questions with context", async () => {
	const { tool } = registerMockTool();

	const result = await tool.execute(
		"call-1",
		{
			title: "Clarify",
			questions: [
				{
					id: "layout",
					label: "Layout",
					prompt: "Which layout?",
					context: "Compact keeps every row on one line.",
					options: [{ value: "compact", label: "Compact" }],
				},
			],
		},
		undefined,
		noop,
		makeCtx(false)
	);

	assert.match(result.content[0].text, CUSTOM_OPTION_RE);
});

test("ask tool rejects invalid payloads before UI opens with structured issues", async () => {
	const { tool } = registerMockTool();

	const result = await tool.execute(
		"call-1",
		{
			title: "Clarify",
			questions: [
				{
					id: "scope",
					prompt: "Pick scope",
					options: [{ value: "small", label: "Small" }],
				},
				{
					id: "scope",
					prompt: "Pick tone",
					options: [{ value: "direct", label: "Direct" }],
				},
			],
		},
		undefined,
		noop,
		makeCtx(true)
	);

	assert.equal(result.details.cancelled, true);
	assert.equal(result.details.questions.length, 0);
	assert.deepEqual(result.details.error, {
		kind: "invalid_input",
		issues: [
			{
				path: "questions[1].id",
				message: 'Question 2: duplicate question id "scope"',
			},
		],
	});
	assert.match(result.content[0].text, DUPLICATE_ID_RE);
});

test("ask tool reports missing option values with structured issues", async () => {
	const { tool } = registerMockTool();

	const result = await tool.execute(
		"call-1",
		{
			title: "Clarify",
			questions: [
				{
					id: "api_style",
					prompt: "Pick API style",
					options: [{ label: "REST" } as never],
				},
			],
		},
		undefined,
		noop,
		makeCtx(true)
	);

	assert.equal(result.details.cancelled, true);
	assert.deepEqual(result.details.error, {
		kind: "invalid_input",
		issues: [
			{
				path: "questions[0].options[0].value",
				message: "Question 1, option 1: value is required",
			},
		],
	});
	assert.match(result.content[0].text, MISSING_OPTION_VALUE_RE);
});

test("ask tool reports empty questions with structured issues", async () => {
	const { tool } = registerMockTool();

	const result = await tool.execute(
		"call-1",
		{
			title: "Clarify",
			questions: [],
		},
		undefined,
		noop,
		makeCtx(true)
	);

	assert.equal(result.details.cancelled, true);
	assert.deepEqual(result.details.error, {
		kind: "invalid_input",
		issues: [
			{
				path: "questions",
				message: "At least one question is required",
			},
		],
	});
	assert.match(result.content[0].text, EMPTY_QUESTIONS_RE);
});

test("ask tool reports invalid question types with structured issues", async () => {
	const { tool } = registerMockTool();

	const result = await tool.execute(
		"call-1",
		{
			title: "Clarify",
			questions: [
				{
					id: "layout",
					prompt: "Pick layout",
					type: "grid" as never,
					options: [{ value: "compact", label: "Compact" }],
				},
			],
		},
		undefined,
		noop,
		makeCtx(true)
	);

	assert.equal(result.details.cancelled, true);
	assert.deepEqual(result.details.error, {
		kind: "invalid_input",
		issues: [
			{
				path: "questions[0].type",
				message:
					'Question 1: invalid type "grid"; expected "single" or "multi"',
			},
		],
	});
	assert.match(result.content[0].text, INVALID_TYPE_RE);
});

test("ask tool converts legacy preview questions into question context", async () => {
	const { tool } = registerMockTool();
	const prepared = tool.prepareArguments({
		questions: [
			{
				id: "layout",
				prompt: "Pick layout",
				type: "preview",
				options: [
					{ value: "compact", label: "Compact", preview: "One line per row" },
					{ value: "roomy", label: "Roomy", preview: "Two lines per row" },
				],
			},
		],
	}) as AskParams;

	assert.equal(Value.Check(AskParamsSchema, prepared), true);
	assert.deepEqual(prepared.questions[0], {
		id: "layout",
		prompt: "Pick layout",
		type: "single",
		context: "Compact\nOne line per row\n\nRoomy\nTwo lines per row",
		options: [
			{ value: "compact", label: "Compact" },
			{ value: "roomy", label: "Roomy" },
		],
	});
	const result = await tool.execute(
		"call-legacy",
		prepared,
		undefined,
		noop,
		makeCtx(false)
	);
	assert.equal(result.details.error, undefined);
});

test("ask tool accepts blank optional presentation fields", async () => {
	const { tool } = registerMockTool();
	const params: AskParams = {
		title: "   ",
		questions: [
			{
				id: "scope",
				label: "  ",
				prompt: "Pick scope",
				context: "\t",
				options: [
					{
						value: "small",
						label: "Small",
						description: " ",
					},
				],
			},
		],
	};
	assert.equal(Value.Check(AskParamsSchema, params), true);
	const result = await tool.execute(
		"call-blank-optionals",
		params,
		undefined,
		noop,
		makeCtx(false)
	);

	assert.equal(result.details.error, undefined);
	assert.equal(result.details.title, undefined);
	assert.equal(result.details.questions[0].label, "Q1");
});

test("ask tool prepares missing and blank option labels before schema validation", async () => {
	const { tool } = registerMockTool();
	const raw = {
		questions: [
			{
				id: "encryption",
				prompt: "Choose encryption",
				options: [
					{ value: "region-local-kms-reencrypt-dek" },
					{ value: "follow_up", label: "  " },
					{ value: "existing", label: "Existing label" },
				],
			},
		],
	};

	assert.equal(Value.Check(AskParamsSchema, raw), false);
	const prepared = tool.prepareArguments(raw) as AskParams;
	assert.equal(Value.Check(AskParamsSchema, prepared), true);
	assert.deepEqual(
		prepared.questions[0]?.options.map((option) => option.label),
		["Region local kms reencrypt dek", "Follow up", "Existing label"]
	);

	const result = await tool.execute(
		"call-prepared-labels",
		prepared,
		undefined,
		noop,
		makeCtx(false)
	);
	assert.equal(result.details.error, undefined);
});

test("public schema requires semantic identifiers and labels", () => {
	const { tool } = registerMockTool();
	assert.deepEqual(tool.parameters.required, ["questions"]);
	const questionSchema = tool.parameters.properties.questions.items;
	assert.deepEqual(questionSchema.required, ["id", "prompt", "options"]);
	assert.deepEqual(questionSchema.properties.options.items.required, [
		"value",
		"label",
	]);

	const missingLabel = {
		questions: [
			{
				id: "scope",
				prompt: "Pick scope",
				options: [{ value: "small" }],
			},
		],
	};
	assert.equal(Value.Check(AskParamsSchema, missingLabel), false);
});

test("ask tool transcript renderers summarize call and cancelled result", () => {
	const { tool } = registerMockTool();
	const theme = {
		bold: (text: string) => text,
		fg: (_token: string, text: string) => text,
	};

	const callText = tool.renderCall(
		{
			questions: [
				{ label: "Goal", options: [], prompt: "Q?", id: "goal" },
				{ label: "Tone", options: [], prompt: "Q?", id: "tone" },
			],
		},
		theme
	).text;
	assert.equal(callText, "ask_user 2 question(s) (Goal, Tone)");

	const resultText = tool.renderResult(
		{
			content: [{ type: "text", text: "ignored" }],
			details: {
				cancelled: true,
				mode: "submit",
				questions: [],
				answers: {},
			},
		},
		undefined,
		theme
	).text;
	assert.equal(resultText, "Cancelled");

	const invalidText = tool.renderResult(
		{
			content: [{ type: "text", text: "ignored" }],
			details: {
				cancelled: true,
				mode: "submit",
				questions: [],
				answers: {},
				error: {
					kind: "invalid_input",
					issues: [],
				},
			},
		},
		undefined,
		theme
	).text;
	assert.equal(invalidText, "Invalid tool payload");

	const schemaErrorText = tool.renderResult(
		{
			content: [
				{
					type: "text",
					text: 'Validation failed for tool "ask_user": missing label',
				},
			],
			details: {},
		},
		undefined,
		theme
	).text;
	assert.equal(
		schemaErrorText,
		'Validation failed for tool "ask_user": missing label'
	);
});
