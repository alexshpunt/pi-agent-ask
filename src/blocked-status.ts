import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type AskEvents = Pick<ExtensionAPI["events"], "emit">;

const blockedOwners = new WeakMap<AskEvents, { count: number }>();

/** Keep shared blocked status active until every queue and foreground surface releases it. */
export function acquireAskBlocked(events?: AskEvents): () => void {
	if (!events) {
		return () => undefined;
	}
	const state = blockedOwners.get(events) ?? { count: 0 };
	blockedOwners.set(events, state);
	state.count += 1;
	if (state.count === 1) {
		emitBlocked(events, true);
	}
	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		state.count -= 1;
		if (!state.count) {
			blockedOwners.delete(events);
			emitBlocked(events, false);
		}
	};
}

function emitBlocked(events: AskEvents, active: boolean): void {
	try {
		events.emit(
			"herdr:blocked",
			active
				? { active: true, label: "Waiting for user response" }
				: { active: false }
		);
	} catch {
		// Status listeners must not affect questions or answer delivery.
	}
}
