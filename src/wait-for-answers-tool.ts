import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatQueuedAnswer } from "./background-answer.ts";
import type { BackgroundAskRuntime } from "./background-ask.ts";
import {
	type WaitForAnswersResult,
	WaitForAnswersSchema,
} from "./background-ask-state.ts";

/** Register the explicit wait gate. Completed answers use this result instead of duplicate messages. */
export function registerWaitForAnswersTool(
	pi: ExtensionAPI,
	queue: BackgroundAskRuntime
): void {
	pi.registerTool({
		name: "wait_for_answers",
		exposure: "model-only",
		label: "Wait for Answers",
		description:
			"Wait until all outstanding background ask_user forms finish. Use when no independent work remains or before a step that depends on answers. No built-in timeout. Aborting the wait leaves questions queued. Returns only results not already delivered asynchronously; cancellation and elaboration are not approval.",
		promptSnippet:
			"Wait for pending background user answers before dependent decisions",
		promptGuidelines: [
			"Use wait_for_answers when independent work is exhausted. Read existing background-answer messages too; results already delivered there are not repeated by this tool.",
		],
		parameters: Type.Object({}),
		outputSchema: WaitForAnswersSchema,
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				throw new Error("wait_for_answers requires interactive TUI mode.");
			}
			const result = await queue.wait(signal);
			return {
				content: [{ type: "text", text: formatWaitResult(result) }],
				details: result,
				structuredContent: result,
			};
		},
		renderCall: (_args, theme) =>
			new Text(theme.fg("toolTitle", theme.bold("wait_for_answers")), 0, 0),
		renderResult: (result) =>
			new Text(
				result.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
				0,
				0
			),
	});
}

function formatWaitResult(result: WaitForAnswersResult): string {
	return result.results.length
		? result.results.map(formatQueuedAnswer).join("\n\n")
		: "No outstanding background answers. Previously delivered answers are already in context.";
}
