import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AskEvents } from "./blocked-status.ts";

type RestingState = "idle" | "done" | "error";
interface Status {
	app: "pi";
	kind?: "question";
	message?: string;
	state: RestingState | "working" | "blocked";
}
interface StatusTerminal {
	setProgramStatus?(status: Status): void;
}
interface QuestionStatus {
	context?: ExtensionContext;
	label?: string;
	outcome: RestingState;
	pending?: NodeJS.Immediate;
	resting: RestingState;
	terminal?: StatusTerminal;
}

const statuses = new WeakMap<AskEvents, QuestionStatus>();

function getStatus(events: AskEvents): QuestionStatus {
	let status = statuses.get(events);
	if (!status) {
		status = { outcome: "done", resting: "idle" };
		statuses.set(events, status);
	}
	return status;
}

function report(status: QuestionStatus): void {
	if (status.context?.mode !== "tui") {
		return;
	}
	try {
		status.terminal?.setProgramStatus?.(
			status.label
				? {
						app: "pi",
						state: "blocked",
						kind: "question",
						message: status.label,
					}
				: {
						app: "pi",
						state: status.context.isIdle() ? status.resting : "working",
					}
		);
	} catch {
		// Terminal status must never change question results or cleanup.
	}
}

function cancelPending(status: QuestionStatus): void {
	clearImmediate(status.pending);
	status.pending = undefined;
}

function scheduleReport(status: QuestionStatus): void {
	cancelPending(status);
	// Pi mounts custom dialogs and writes lifecycle status after extension hooks.
	// Read current ownership when this runs, never a captured blocked/clear state.
	status.pending = setImmediate(() => {
		status.pending = undefined;
		report(status);
	});
}

/** Uses Pi's negotiated OSC 7501 transport when the host terminal provides it. */
export function bindQuestionTerminal(
	events: AskEvents | undefined,
	terminal: unknown,
	context: ExtensionContext
): void {
	if (!events || context.mode !== "tui") {
		return;
	}
	const status = getStatus(events);
	status.terminal =
		typeof terminal === "object" &&
		terminal !== null &&
		"setProgramStatus" in terminal &&
		typeof terminal.setProgramStatus === "function"
			? (terminal as StatusTerminal)
			: undefined;
	status.context = context;
	if (status.label) {
		report(status);
		scheduleReport(status);
	}
}

/** The balanced wait aggregate is the only source of question ownership. */
export function reportQuestionWait(
	events: AskEvents,
	label: string | undefined
): void {
	const status = getStatus(events);
	status.label = label;
	cancelPending(status);
	report(status);
	if (label) {
		scheduleReport(status);
	}
}

export function registerQuestionStatus(pi: ExtensionAPI): void {
	const status = getStatus(pi.events);
	const reassert = (_event: unknown, context: ExtensionContext) => {
		status.context = context;
		if (status.label && context.mode === "tui") {
			scheduleReport(status);
		}
	};
	pi.on("agent_start", (event, context) => {
		status.outcome = "done";
		reassert(event, context);
	});
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") {
			status.outcome = event.message.stopReason === "error" ? "error" : "done";
		}
	});
	pi.on("agent_settled", (event, context) => {
		status.resting =
			"aborted" in event && event.aborted ? "idle" : status.outcome;
		reassert(event, context);
	});
	pi.on("ui_prompt_end", reassert);
	pi.on("session_before_compact", reassert);
	pi.on("session_compact", reassert);
	pi.on("session_compact_failed", reassert);
	pi.on("session_start", () => {
		cancelPending(status);
		status.resting = "idle";
		status.outcome = "done";
	});
	pi.on("session_shutdown", () => {
		cancelPending(status);
		if (status.label) {
			status.label = undefined;
			report(status);
		}
		status.context = undefined;
		status.terminal = undefined;
	});
}
