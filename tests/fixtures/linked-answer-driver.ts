import { writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import backgroundDriver from "./background-driver.ts";
import { captureLinkedViews, type LinkedHost } from "./linked-answer-view.ts";

/** Exercise actual nested execution and observe the unmodified fullscreen consumer. */
// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function linkedAnswerDriver(pi: ExtensionAPI): void {
	backgroundDriver(pi);
	let host: LinkedHost | undefined;
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setWidget("ask-test:host", (tui) => {
			host = tui as LinkedHost;
			return new Text("", 0, 0);
		});
	});
	pi.registerTool({
		name: "nested_question",
		label: "Nested question",
		description: "Queue a background form through a real nested execution.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, { id }, signal, _update, ctx) {
			const execution = await ctx.executeTool(
				"ask_user",
				{
					background: true,
					title: id,
					questions: [
						{
							id,
							prompt: `Choose ${id}?`,
							options: [{ value: "yes", label: `Yes ${id}` }],
						},
					],
				},
				{ signal }
			);
			return {
				...execution.result,
				content: [{ type: "text", text: `Nested receipt ${id}` }],
			};
		},
	});
	pi.on("agent_before_settle", async () => {
		if (host && process.env.ASK_LINKED_CAPTURE) {
			await writeFile(
				process.env.ASK_LINKED_CAPTURE,
				JSON.stringify(captureLinkedViews(host))
			);
		}
	});
}
