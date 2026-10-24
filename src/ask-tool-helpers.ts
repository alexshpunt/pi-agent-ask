import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Static } from "typebox";
import type { AskQueuedSchema } from "./background-ask-state.ts";
import { UI_DIMENSIONS } from "./constants/ui.ts";
import { imageContent } from "./images.ts";
import { renderResultText } from "./result.ts";
import type { AskResultSchema } from "./result-schema.ts";
import { createInitialState } from "./state/create.ts";
import { collectValidationIssues } from "./state/normalize.ts";
import { summarizeResult, toAskResult } from "./state/result.ts";
import type {
	AskParams,
	AskQuestionInput,
	AskResult,
	AskValidationIssue,
} from "./types.ts";

export const ASK_TOOL_DESCRIPTION =
	"Use ask_user when you need something only the user can provide: information you could not find through search or other tools, their opinion or preference, or a choice between options. The call returns the user's answers.";

export const ASK_BACKGROUND_ONLY_TOOL_DESCRIPTION =
	"Use ask_user when you need something only the user can provide: information you could not find through search or other tools, their opinion or preference, or a choice between options. The call returns a request ID; the answers arrive later as a background-answer message.";

interface ValidateParamsOptions {
	presentSingleAsMulti?: boolean;
}

export function validateParams(
	params: AskParams,
	options: ValidateParamsOptions = {}
):
	| { ok: true; state: ReturnType<typeof createInitialState> }
	| { ok: false; issues: AskValidationIssue[] } {
	const issues = collectValidationIssues(params);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return {
		ok: true,
		state: createInitialState(params, options),
	};
}

export function invalidPayloadResponse(
	params: AskParams,
	issues: AskValidationIssue[]
) {
	const result: Static<typeof AskResultSchema> = errorResultDetails(
		params,
		issues
	);
	return {
		content: [{ type: "text" as const, text: formatValidationError(issues) }],
		details: result,
		structuredContent: result,
	};
}

export function nonInteractiveResponse(
	state: ReturnType<typeof createInitialState>
) {
	const result: Static<typeof AskResultSchema> = {
		...toAskResult(state),
		cancelled: true,
	};
	return {
		content: [
			{ type: "text" as const, text: formatNonInteractiveMessage(state) },
		],
		details: result,
		structuredContent: result,
	};
}

export function successfulResponse(result: AskResult) {
	const structuredContent: Static<typeof AskResultSchema> = result;
	const content: [TextContent, ...(TextContent | ImageContent)[]] = [
		{ type: "text", text: summarizeResult(result) },
		...imageContent(result),
	];
	return {
		content,
		details: structuredContent,
		structuredContent,
	};
}

type ToolTheme = ExtensionContext["ui"]["theme"];

export function renderAskToolCall(args: unknown, theme: ToolTheme) {
	const params = args as AskParams;
	const labels = Array.isArray(params.questions)
		? params.questions
				.map(
					(question: AskQuestionInput, index) =>
						question.label?.trim() || `Q${index + 1}`
				)
				.join(", ")
		: "";
	let text = theme.fg("toolTitle", theme.bold("ask_user "));
	text += theme.fg("muted", `${params.questions?.length ?? 0} question(s)`);
	if (labels) {
		text += theme.fg(
			"dim",
			` (${truncateToWidth(labels, UI_DIMENSIONS.callLabelTruncateWidth)})`
		);
	}
	return new Text(text, 0, 0);
}

export function renderAskToolResult(
	result: {
		content: Array<{ type?: string; text?: string }>;
		details?: AskResult | Static<typeof AskQueuedSchema>;
	},
	_options: unknown,
	theme: ToolTheme
) {
	const details = result.details;
	if (details && "status" in details) {
		return new Text(
			`${details.questionIds.length} question(s) queued · ${details.pendingRequests} form(s) pending`,
			0,
			0
		);
	}
	if (!(details && Array.isArray(details.questions))) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? (text.text ?? "") : "", 0, 0);
	}
	const text = renderResultText(details);
	return new Text(
		details.error || details.cancelled ? theme.fg("warning", text) : text,
		0,
		0
	);
}

function errorResultDetails(
	params: AskParams,
	issues: AskValidationIssue[]
): AskResult {
	return {
		title: params.title,
		cancelled: true,
		mode: "submit",
		questions: [],
		answers: {},
		error: {
			kind: "invalid_input",
			issues,
		},
	};
}

function formatValidationError(issues: AskValidationIssue[]): string {
	return [
		"Invalid ask_user payload:",
		...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
	].join("\n");
}

function formatNonInteractiveMessage(
	state: ReturnType<typeof createInitialState>
): string {
	const lines = [
		"Needs user input: ask_user requires interactive TUI mode.",
		"Run same tool call in interactive TUI mode, or ask user these questions manually:",
	];

	for (const [index, question] of state.questions.entries()) {
		lines.push(`${index + 1}. ${question.label}: ${question.prompt}`);
		for (const option of question.options) {
			lines.push(`   - ${option.label} [${option.value}]`);
		}
		lines.push("   - Type your own [custom]");
	}

	lines.push(
		"details.questions contains normalized pending questions. details.answers stays empty until user responds."
	);
	return lines.join("\n");
}
