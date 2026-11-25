import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function escapeDriver(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (...args) => {
				const host = args[0] as (typeof args)[0] & {
					getFocusedComponent(): Component | null;
					handleTerminalInput(data: string): void;
				};
				const component = await factory(...args);
				setImmediate(() => {
					assert.equal(host.getFocusedComponent(), component);
					host.handleTerminalInput("\u001b");
				});
				return component;
			}, options);
	});
}
