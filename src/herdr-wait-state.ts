import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { reportQuestionWait } from "./program-status.ts";

type AskEvents = Pick<ExtensionAPI["events"], "emit">;
const activeWaits = new WeakMap<AskEvents, Map<symbol, string>>();

/** Keep status blocked until every visible question surface and explicit wait ends. */
export function beginUserWait(
	events: AskEvents | undefined,
	label: string
): () => void {
	if (!events) {
		return () => undefined;
	}
	let owners = activeWaits.get(events);
	if (!owners) {
		owners = new Map();
		activeWaits.set(events, owners);
	}
	const owner = Symbol("ask wait");
	owners.set(owner, label);
	if (owners.size === 1) {
		publish(events, owners);
	}
	return () => {
		if (!owners.delete(owner)) {
			return;
		}
		if (!owners.size) {
			activeWaits.delete(events);
			publish(events, owners);
		}
	};
}

function publish(events: AskEvents, owners: Map<symbol, string>): void {
	const label = [...owners.values()].at(-1);
	reportQuestionWait(events, label);
	try {
		events.emit(
			"herdr:blocked",
			label === undefined ? { active: false } : { active: true, label }
		);
	} catch {
		// Status reporting must not change question or wait results.
	}
}
