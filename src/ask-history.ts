import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
	type HistoryCompletion,
	HistoryCompletionSchema,
	type HistoryKey,
	type HistoryRecord,
	type HistoryRequest,
	HistoryRequestSchema,
} from "./ask-history-schema.ts";
import type { QueuedAnswer } from "./background-ask-state.ts";
import type { AskResultAnswer, AskState } from "./types.ts";

const REQUEST_ENTRY = "ask:history-request";
const COMPLETION_ENTRY = "ask:history-completed";
type HistoryWriter = Pick<ExtensionAPI, "appendEntry">;

/** Save the normalized, loaded form before opening UI. Each invocation gets a new key. */
export function appendAskHistoryRequest(
	pi: HistoryWriter,
	toolCallId: string,
	state: AskState,
	background: boolean
): string {
	const requestId = randomUUID();
	const questions = state.questions.map(({ requestedType, ...question }) => ({
		...question,
		type: requestedType ?? question.type,
	}));
	pi.appendEntry(
		REQUEST_ENTRY,
		structuredClone({
			version: 1,
			requestId,
			toolCallId,
			title: state.title,
			background,
			createdAt: new Date().toISOString(),
			questions,
		} satisfies HistoryRequest)
	);
	return requestId;
}

/** Save an outcome before delivering it to the agent, including nested tool calls. */
export function appendAskHistoryCompletion(
	pi: HistoryWriter,
	completion: QueuedAnswer
): void {
	pi.appendEntry(
		COMPLETION_ENTRY,
		structuredClone({ version: 1, ...completion } satisfies HistoryCompletion)
	);
}

/** Rebuild from the selected branch only, never from a summary or other file entries. */
export function readAskHistory(
	branch: readonly SessionEntry[]
): HistoryRecord[] {
	const requests = new Map<string, HistoryRequest>();
	const completions = new Map<string, HistoryCompletion>();
	for (const entry of branch) {
		if (entry.type !== "custom") {
			continue;
		}
		if (
			entry.customType === REQUEST_ENTRY &&
			Value.Check(HistoryRequestSchema, entry.data)
		) {
			requests.set(entry.data.requestId, entry.data);
		}
		if (
			entry.customType === COMPLETION_ENTRY &&
			Value.Check(HistoryCompletionSchema, entry.data)
		) {
			completions.set(entry.data.requestId, entry.data);
		}
	}
	return [...requests.values()].flatMap((request) =>
		request.questions.map((question) =>
			historyRecord(request, question, completions.get(request.requestId))
		)
	);
}

function historyRecord(
	request: HistoryRequest,
	question: HistoryRequest["questions"][number],
	completion?: HistoryCompletion
): HistoryRecord {
	const result = completion?.result;
	const answer =
		result && Object.hasOwn(result.answers, question.id)
			? result.answers[question.id]
			: undefined;
	const elaboration = result?.elaboration?.items.filter(
		(item) => item.question.id === question.id
	);
	const finalQuestion = result?.questions.find(
		(item) => item.id === question.id
	);
	return {
		requestId: request.requestId,
		questionId: question.id,
		title: request.title,
		createdAt: request.createdAt,
		background: request.background,
		question: {
			...question,
			...(finalQuestion
				? {
						type: finalQuestion.type,
						presentedType: finalQuestion.presentedType,
					}
				: {}),
		},
		status: outcomeStatus(completion, question.id, answer),
		mode: result?.mode,
		answer,
		elaboration,
		error: completion?.error,
	};
}

function outcomeStatus(
	completion: HistoryCompletion | undefined,
	questionId: string,
	answer?: AskResultAnswer
): HistoryRecord["status"] {
	if (completion?.error) {
		return "error";
	}
	const result = completion?.result;
	if (!result) {
		return "waiting";
	}
	if (result.cancelled) {
		return "cancelled";
	}
	if (
		result.mode === "elaborate" &&
		(result.continuation?.affectedQuestionIds.includes(questionId) ||
			result.elaboration?.items.some(
				(item) => item.question.id === questionId
			) ||
			!result.elaboration?.items.length)
	) {
		return "clarification";
	}
	return hasCommittedAnswer(answer) ? "answered" : "skipped";
}

/** Notes alone are not a committed answer. Clarification can still carry a prior answer. */
export function hasCommittedAnswer(answer?: AskResultAnswer): boolean {
	return Boolean(
		answer && (answer.values.length > 0 || answer.customText?.trim())
	);
}

/** Resolve the whole explicit selection before writing. No missing key is silently skipped. */
export function selectAskHistory(
	records: readonly HistoryRecord[],
	keys?: readonly HistoryKey[]
): HistoryRecord[] {
	if (!keys) {
		return [...records];
	}
	if (!keys.length) {
		throw new Error(
			"Select at least one question or omit keys to export all history."
		);
	}
	const selected = new Set<HistoryRecord>();
	for (const key of keys) {
		const record = records.find(
			(item) =>
				item.requestId === key.requestId && item.questionId === key.questionId
		);
		if (!record) {
			throw new Error(
				`Question not found on the current branch: ${key.requestId} / ${key.questionId}`
			);
		}
		selected.add(record);
	}
	return records.filter((record) => selected.has(record));
}

/** Recover the original journal identity when an interrupted tool request is reopened. */
export function findPendingHistoryRequest(
	branch: readonly SessionEntry[],
	toolCallId: string
): string | undefined {
	const completed = new Set<string>();
	for (const entry of [...branch].reverse()) {
		if (entry.type !== "custom") {
			continue;
		}
		if (
			entry.customType === COMPLETION_ENTRY &&
			Value.Check(HistoryCompletionSchema, entry.data)
		) {
			completed.add(entry.data.requestId);
		}
		if (
			entry.customType === REQUEST_ENTRY &&
			Value.Check(HistoryRequestSchema, entry.data) &&
			entry.data.toolCallId === toolCallId &&
			!completed.has(entry.data.requestId)
		) {
			return entry.data.requestId;
		}
	}
	return;
}
