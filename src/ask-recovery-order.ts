import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { findPendingHistoryRequest } from "./ask-history.ts";
import {
	type AskSurfaceReservation,
	reserveAskSurface,
} from "./ask-surface.ts";
import {
	ASK_QUEUED_ENTRY,
	restoreQueuedRequests,
	restoreQueueHidden,
} from "./background-ask-state.ts";
import type { PendingAskToolCall } from "./pending-ask.ts";

interface RecoveryCandidate {
	foreground: boolean;
	position: number;
	requestId: string;
}

/** Reserve recovered forms together, preserving their branch-local arrival order. */
export function reserveRecoverySurfaces(
	branch: readonly SessionEntry[],
	pendingAsk?: PendingAskToolCall
): {
	background: ReadonlyMap<string, AskSurfaceReservation>;
	foreground?: AskSurfaceReservation;
} {
	const candidates: RecoveryCandidate[] = restoreQueueHidden(branch)
		? []
		: restoreQueuedRequests(branch)
				.filter((request) => !request.completion)
				.map((request) => ({
					foreground: false,
					requestId: request.requestId,
					position: recoveryPosition(
						branch,
						request.requestId,
						request.toolCallId
					),
				}));
	if (pendingAsk) {
		const requestId = findPendingHistoryRequest(branch, pendingAsk.toolCallId);
		candidates.push({
			foreground: true,
			requestId: requestId ?? pendingAsk.toolCallId,
			position: recoveryPosition(branch, requestId, pendingAsk.toolCallId),
		});
	}
	candidates.sort((left, right) => left.position - right.position);
	const background = new Map<string, AskSurfaceReservation>();
	let foreground: AskSurfaceReservation | undefined;
	for (const candidate of candidates) {
		const surface = reserveAskSurface();
		if (candidate.foreground) {
			foreground = surface;
		} else {
			background.set(candidate.requestId, surface);
		}
	}
	return { background, foreground };
}

function recoveryPosition(
	branch: readonly SessionEntry[],
	requestId: string | undefined,
	toolCallId: string | undefined
): number {
	if (requestId) {
		const history = branch.findIndex((entry) =>
			matchesRequest(entry, "ask:history-request", requestId)
		);
		if (history >= 0) {
			return history;
		}
		const queued = branch.findIndex((entry) =>
			matchesRequest(entry, ASK_QUEUED_ENTRY, requestId)
		);
		if (queued >= 0) {
			return queued;
		}
	}
	const tool = branch.findIndex(
		(entry) =>
			entry.type === "message" &&
			entry.message.role === "assistant" &&
			entry.message.content.some(
				(part) => part.type === "toolCall" && part.id === toolCallId
			)
	);
	return tool >= 0 ? tool : branch.length;
}

function matchesRequest(
	entry: SessionEntry,
	customType: string,
	requestId: string
): boolean {
	return (
		entry.type === "custom" &&
		entry.customType === customType &&
		!!entry.data &&
		typeof entry.data === "object" &&
		(entry.data as { requestId?: unknown }).requestId === requestId
	);
}
