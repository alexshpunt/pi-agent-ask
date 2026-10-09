import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { validateParams } from "./ask-tool-helpers.ts";
import { AskResultSchema } from "./result-schema.ts";
import { AskParamsSchema } from "./schema.ts";
import type { AskParams } from "./types.ts";

export const ASK_QUEUED_ENTRY = "ask:queued";
export const ASK_COMPLETED_ENTRY = "ask:queue-completed";
export const ASK_ANSWER_MESSAGE = "ask:background-answer";

/** Receipt only: queued does not mean answered or approved. */
export const AskQueuedSchema = Type.Object({
	status: Type.Literal("queued"),
	requestId: Type.String(),
	questionIds: Type.Array(Type.String()),
	pendingRequests: Type.Integer({ minimum: 0 }),
});

/** One terminal form, including explicit cancellation, elaboration, or a UI failure. */
export const QueuedAnswerSchema = Type.Object({
	requestId: Type.String(),
	result: Type.Optional(AskResultSchema),
	error: Type.Optional(Type.String()),
});

/** Results not already delivered asynchronously, returned by the explicit wait. */
export const WaitForAnswersSchema = Type.Object({
	status: Type.Literal("complete"),
	requestIds: Type.Array(Type.String()),
	results: Type.Array(QueuedAnswerSchema),
});

const QueuedEntrySchema = Type.Object({
	version: Type.Literal(1),
	requestId: Type.String(),
	params: AskParamsSchema,
	toolCallId: Type.Optional(Type.String()),
	presentSingleAsMulti: Type.Boolean(),
});

export type QueuedAnswer = Static<typeof QueuedAnswerSchema>;
export type WaitForAnswersResult = Static<typeof WaitForAnswersSchema>;

export interface QueuedRequest {
	completion?: QueuedAnswer;
	delivered: boolean;
	params: AskParams;
	presentSingleAsMulti: boolean;
	requestId: string;
	/** Original Pi tool-call identity, distinct from the generated journal key. */
	toolCallId?: string;
}

/** Replay only the active branch. Actual transcript delivery, not intent to send, is authoritative. */
export function restoreQueuedRequests(
	branch: readonly SessionEntry[]
): QueuedRequest[] {
	const requests = new Map<string, QueuedRequest>();
	const delivered = new Set(branch.flatMap(deliveredRequestIds));
	for (const entry of branch) {
		const queued = queuedRequest(entry);
		if (queued && !requests.has(queued.requestId)) {
			requests.set(queued.requestId, queued);
		}
		const completion = completedAnswer(entry);
		const request = completion && requests.get(completion.requestId);
		if (request) {
			request.completion = completion;
		}
	}
	return [...requests.values()].map((request) => ({
		...request,
		delivered: delivered.has(request.requestId),
	}));
}

function queuedRequest(entry: SessionEntry): QueuedRequest | undefined {
	if (
		entry.type !== "custom" ||
		entry.customType !== ASK_QUEUED_ENTRY ||
		!Value.Check(QueuedEntrySchema, entry.data)
	) {
		return;
	}
	if (!validateParams(entry.data.params).ok) {
		return;
	}
	return { ...entry.data, delivered: false };
}

function completedAnswer(entry: SessionEntry): QueuedAnswer | undefined {
	if (
		entry.type !== "custom" ||
		entry.customType !== ASK_COMPLETED_ENTRY ||
		!Value.Check(QueuedAnswerSchema, entry.data)
	) {
		return;
	}
	return entry.data.result || entry.data.error ? entry.data : undefined;
}

function deliveredRequestIds(entry: SessionEntry): string[] {
	if (
		entry.type === "custom_message" &&
		entry.customType === ASK_ANSWER_MESSAGE &&
		Value.Check(QueuedAnswerSchema, entry.details)
	) {
		return [entry.details.requestId];
	}
	if (entry.type !== "message" || entry.message.role !== "toolResult") {
		return [];
	}
	const message = entry.message;
	if (
		message.toolName !== "wait_for_answers" ||
		message.isError ||
		!Value.Check(WaitForAnswersSchema, message.details)
	) {
		return [];
	}
	return message.details.results.map((result) => result.requestId);
}
