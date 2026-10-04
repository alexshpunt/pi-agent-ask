import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type {
	ExternalAskConnection,
	ExternalAskRequest,
} from "../../src/external-ui.ts";
import type { RemoteAskStartedEvent } from "../../src/remote-ask.ts";

function scenarioResponse(scenario: string) {
	if (scenario === "cancel") {
		return { kind: "cancel" };
	}
	if (scenario === "failure") {
		throw new Error("External UI disconnected");
	}
	const questionId = scenario === "invalid-id" ? "wrong" : "color";
	const value = scenario === "invalid-value" ? "wrong" : "blue";
	return { kind: "answer", answers: { [questionId]: { values: [value] } } };
}
// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function externalUiDriver(pi: ExtensionAPI): void {
	let scenario = "answer";
	let ctx: ExtensionContext | undefined;
	let request: ExternalAskRequest | undefined;
	let resultSeen = false;
	let pendingBeforeResponse = false;
	pi.on("tool_call", (event, context) => {
		if (event.toolName === "ask_user") {
			scenario = String(event.input.title ?? "answer");
			ctx = context;
		}
	});
	pi.on("tool_result", (event) => {
		if (event.toolName === "ask_user") {
			resultSeen = true;
		}
	});
	pi.events.on("@eko24ive/pi-ask:started", (data) => {
		if (ctx?.mode !== "tui") {
			return;
		}
		const started = data as RemoteAskStartedEvent;
		setTimeout(
			() =>
				pi.events.emit("@eko24ive/pi-ask:submit", {
					version: 1,
					flowId: started.flowId,
					requestId: "tui-answer",
					response: {
						kind: "answer",
						answers: { color: { values: ["blue"] } },
					},
				}),
			100
		);
	});
	pi.events.on("@eko24ive/pi-ask:external-ui", (data) => {
		if (scenario === "unconnected") {
			return;
		}
		(data as ExternalAskConnection).connect({
			version: 1,
			id: "test-ui",
			async open(input) {
				request = input;
				if (scenario === "abort") {
					ctx?.abort();
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
				pendingBeforeResponse = !resultSeen;
				return scenarioResponse(scenario);
			},
		});
	});
	pi.registerTool({
		name: "external_ui_stats",
		label: "External UI stats",
		description: "Report fixture connection lifecycle.",
		parameters: Type.Object({}),
		execute() {
			return Promise.resolve({
				content: [{ type: "text" as const, text: "Fixture lifecycle" }],
				details: {
					opened: Boolean(request),
					closed: request?.signal.aborted ?? false,
					pendingBeforeResponse,
				},
			});
		},
	});
}
