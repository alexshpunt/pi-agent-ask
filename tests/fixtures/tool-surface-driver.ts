import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// biome-ignore lint/style/noDefaultExport: Pi loads fixture extensions through a default factory.
export default function toolSurfaceDriver(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "inspect_ask_surface",
		label: "Inspect ask surface",
		description: "Read the real registered ask commands and tools.",
		parameters: Type.Object({}),
		execute() {
			const details = {
				commands: pi.getCommands().map((command) => command.name),
				tools: pi.getAllTools().map((tool) => tool.name),
			};
			return Promise.resolve({
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			});
		},
	});
}
