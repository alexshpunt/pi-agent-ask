import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { type AskDraft, restoreAskDraft } from "./ask-draft.ts";
import { validateParams } from "./ask-tool-helpers.ts";
import { AskResultSchema } from "./result-schema.ts";
import { AskParamsSchema } from "./schema.ts";
import { prepareAskParams } from "./state/normalize.ts";
import type { AskParams } from "./types.ts";

export const ASK_QUEUED_ENTRY = "ask:queued";
export const ASK_COMPLETED_ENTRY = "ask:queue-completed";
export const ASK_ANSWER_MESSAGE = "ask:background-answer";
export const ASK_DRAFT_ENTRY = "ask:queue-draft";
export const ASK_QUEUE_UI_ENTRY = "ask:queue-ui";

const DraftEntrySchema = Type.Object({
	requestId: Type.String(),
	draft: Type.Unknown(),
});
const QueueUiSchema = Type.Object({ hidden: Type.Boolean() });

/** Receipt only: queued does not mean answered or approved. */
export const AskQueuedSchema = Type.Object({
	status: Type.Literal("queued"),
	requestId: Type.String(),
	questionIds: Type.Array(Type.String()),
	pendingRequests: Type.Integer({ minimum: 0 }),
});

/** One terminal form, including explicit cancellation or a UI failure. */
export const QueuedAnswerSchema = Type.Object({
	requestId: Type.String(),
	parentToolCallId: Type.Optional(Type.String()),
	result: Type.Optional(AskResultSchema),
	error: Type.Optional(Type.String()),
});

/** Results not already delivered asynchronously, returned by the explicit wait. */
export const WaitForAnswersSchema = Type.Union([
	Type.Object({
		status: Type.Literal("complete"),
		requestIds: Type.Array(Type.String()),
		results: Type.Array(QueuedAnswerSchema),
	}),
	Type.Object({
		status: Type.Literal("deferred"),
		reason: Type.Union([Type.Literal("hidden"), Type.Literal("user_message")]),
		requestIds: Type.Array(Type.String()),
		pendingRequestIds: Type.Array(Type.String()),
		results: Type.Array(QueuedAnswerSchema),
	}),
]);

const QueuedEntrySchema = Type.Object({
	version: Type.Literal(1),
	requestId: Type.String(),
	params: AskParamsSchema,
	toolCallId: Type.Optional(Type.String()),
	parentToolCallId: Type.Optional(Type.String()),
	presentSingleAsMulti: Type.Boolean(),
});

export type QueuedAnswer = Static<typeof QueuedAnswerSchema>;
export type WaitForAnswersResult = Static<typeof WaitForAnswersSchema>;

export interface QueuedRequest {
	completion?: QueuedAnswer;
	delivered: boolean;
	draft?: AskDraft;
	params: AskParams;
	/** Real visible execution root captured before the receipt returns. */
	parentToolCallId?: string;
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
	const delivered = getDeliveredRequestIds(branch);
	for (const entry of branch) {
		const queued = queuedRequest(entry);
		if (queued && !requests.has(queued.requestId)) {
			requests.set(queued.requestId, queued);
		}
		restoreDraftEntry(entry, requests);
		const completion = completedAnswer(entry);
		const request = completion && requests.get(completion.requestId);
		if (request) {
			request.completion = completion;
			request.draft = undefined;
		}
	}
	return [...requests.values()].map((request) => ({
		...request,
		delivered: delivered.has(request.requestId),
	}));
}

function restoreDraftEntry(
	entry: SessionEntry,
	requests: Map<string, QueuedRequest>
): void {
	if (
		entry.type !== "custom" ||
		entry.customType !== ASK_DRAFT_ENTRY ||
		!Value.Check(DraftEntrySchema, entry.data)
	) {
		return;
	}
	const request = requests.get(entry.data.requestId);
	if (!request || request.completion) {
		return;
	}
	const draft = restoreAskDraft(entry.data.draft, request.params);
	if (draft) {
		request.draft = draft;
	}
}
/** Visibility belongs to the active branch, independently of agent waiting state. */
export function restoreQueueHidden(branch: readonly SessionEntry[]): boolean {
	let hidden = false;
	for (const entry of branch) {
		if (
			entry.type === "custom" &&
			entry.customType === ASK_QUEUE_UI_ENTRY &&
			Value.Check(QueueUiSchema, entry.data)
		) {
			hidden = entry.data.hidden;
		}
	}
	return hidden;
}
function queuedRequest(entry: SessionEntry): QueuedRequest | undefined {
	if (entry.type !== "custom" || entry.customType !== ASK_QUEUED_ENTRY) {
		return;
	}
	const data =
		entry.data && typeof entry.data === "object"
			? {
					...entry.data,
					params: prepareAskParams((entry.data as { params?: unknown }).params),
				}
			: entry.data;
	if (
		!(Value.Check(QueuedEntrySchema, data) && validateParams(data.params).ok)
	) {
		return;
	}
	return { ...data, delivered: false };
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

/** Delivery evidence survives independently of the queue's recovery journal. */
export function getDeliveredRequestIds(
	branch: readonly SessionEntry[]
): Set<string> {
	return new Set(branch.flatMap(deliveredRequestIds));
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
