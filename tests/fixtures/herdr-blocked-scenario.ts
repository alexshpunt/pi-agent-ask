import { assistantMessage, text, toolCall } from "pi-coding-agent-test";

const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});
const form = (id: string) => ({
	background: true,
	title: id,
	questions: [
		{ id, prompt: `Choose ${id}?`, options: [{ value: "yes", label: "Yes" }] },
	],
});

/** Drive the real Pi agent without a model service while Herdr owns its native PTY. */
export const herdrBlockedConversation = [
	call("first-form", "ask_user", form("first")),
	call("second-form", "ask_user", form("second")),
	call("first", "herdr_queue_probe", { action: "first" }),
	call("second", "herdr_queue_probe", { action: "second" }),
	call("hide", "herdr_queue_probe", { action: "hide" }),
	call("reopen", "herdr_queue_probe", { action: "reopen" }),
	call("idle", "herdr_queue_probe", { action: "idle" }),
	assistantMessage([
		text("Keep the second form open while the agent settles."),
	]),
	call("stats", "herdr_queue_probe", { action: "stats" }),
	assistantMessage([text("Herdr queue verification complete.")]),
];

/** Exercise foreground custom UI and the explicit answer wait on a real host. */
export const herdrForegroundConversation = [
	call("arm-foreground", "herdr_queue_probe", { action: "foreground" }),
	call("foreground-form", "ask_user", {
		...form("foreground"),
		background: false,
	}),
	call("background-form", "ask_user", form("first")),
	call("arm-wait", "herdr_queue_probe", { action: "wait" }),
	call("explicit-wait", "wait_for_answers", {}),
	call("stats", "herdr_queue_probe", { action: "stats" }),
	assistantMessage([
		text("Foreground and explicit wait verification complete."),
	]),
];

/** Leave the second form pending in a session that a new Pi process can resume. */
export const herdrQueueCheckpointConversation = [
	...herdrBlockedConversation.slice(0, 4),
	call("checkpoint", "herdr_queue_probe", { action: "checkpoint" }),
	assistantMessage([text("Queue checkpoint complete.")]),
];

/** Resume without enqueueing a new form, then finish the restored question. */
export const herdrQueueResumeConversation = [
	call("recover", "herdr_queue_probe", { action: "recovered" }),
	call("idle", "herdr_queue_probe", { action: "idle" }),
	assistantMessage([
		text("Keep the recovered form open while the agent settles."),
	]),
	call("stats", "herdr_queue_probe", { action: "stats" }),
	assistantMessage([text("Recovered queue verification complete.")]),
];
