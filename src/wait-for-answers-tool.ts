import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatQueuedAnswer } from "./background-answer.ts";
import type { BackgroundAskRuntime } from "./background-ask.ts";
import {
	type WaitForAnswersResult,
	WaitForAnswersSchema,
} from "./background-ask-state.ts";
import { imageContent } from "./images.ts";

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
			"Use wait_for_answers when no independent work remains or before a step that depends on background answers. Hiding questions or sending a user message releases the wait without cancelling pending requests. Treat deferred waits and skipped questions as unanswered, never as approval.",
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
				content: [
					{ type: "text", text: formatWaitResult(result) },
					...result.results.flatMap((answer) =>
						answer.result ? imageContent(answer.result) : []
					),
				],
				details: result,
				structuredContent: result,
			};
		},
		renderCall: (_args, theme) =>
			new Text(theme.fg("toolTitle", theme.bold("wait_for_answers")), 0, 0),
		renderResult: (result) => {
			const details = result.details as WaitForAnswersResult | undefined;
			if (details?.status === "complete") {
				return new Text(
					`Consumed ${details.results.length} background answer(s).${details.results.length ? " Cards remain at the original calls." : ""}`,
					0,
					0
				);
			}
			if (details?.status === "deferred") {
				return new Text(
					`Questions deferred. ${details.pendingRequestIds.length} questionnaire(s) remain in /ask-queue.`,
					0,
					0
				);
			}
			return new Text(
				result.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
				0,
				0
			);
		},
	});
}

function formatWaitResult(result: WaitForAnswersResult): string {
	if (result.status === "deferred") {
		const pending = result.pendingRequestIds ?? [];
		const summary = `Answer wait released (${result.reason}). ${pending.length} questionnaire(s) remain pending: ${pending.join(", ") || "none"}. Pending questions are unanswered, not cancelled or approved. Do not repeat the wait automatically; follow the user's message or continue only independent work.`;
		return [summary, ...result.results.map(formatQueuedAnswer)].join("\n\n");
	}
	return result.results.length
		? result.results.map(formatQueuedAnswer).join("\n\n")
		: "No outstanding background answers. Previously delivered answers are already in context.";
}
