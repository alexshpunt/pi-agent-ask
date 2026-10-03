import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function escapeDriver(pi: ExtensionAPI): void {
	let background = false;
	let cancel: (() => void) | undefined;
	pi.on("tool_call", (event) => {
		if (event.toolName === "ask_user") {
			background = event.input.background === true;
		}
		if (event.toolName === "wait_for_answers") {
			setImmediate(() => cancel?.());
		}
	});
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (...args) => {
				const component = await factory(...args);
				cancel = () => component.handleInput?.("\u001b");
				if (!background) {
					setImmediate(cancel);
				}
				return component;
			}, options);
	});
}
