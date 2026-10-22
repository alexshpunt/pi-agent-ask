import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function escapeDriver(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (...args) => {
				const component = await factory(...args);
				setImmediate(() => component.handleInput?.("\u001b"));
				return component;
			}, options);
	});
}
