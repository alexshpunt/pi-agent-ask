import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Text, type TUI } from "@earendil-works/pi-tui";

type Host = TUI & {
	getFocusedComponent(): Component | null;
	handleTerminalInput(data: string): void;
};

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function modalFocusDriver(pi: ExtensionAPI): void {
	let tui: Host;
	let settings: Component | null;
	pi.on("session_start", async (_event, ctx) => {
		let close: () => void = () => undefined;
		await ctx.ui.custom<void>(
			(host, _theme, _keys, done) => {
				tui = host as Host;
				close = done;
				return new Text("");
			},
			{
				overlay: true,
				overlayOptions: { nonCapturing: true, visible: () => false },
				onHandle: () => close(),
			}
		);
	});
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "ask_user") {
			return;
		}
		const command = process.env.ASK_TEST_STEREO_ENTRY
			? "/stereo-view settings"
			: "/ask-settings";
		const editor = tui.getFocusedComponent();
		for (const key of command) {
			tui.handleTerminalInput(key);
		}
		tui.handleTerminalInput("\r");
		const deadline = Date.now() + 2000;
		while (!tui.hasOverlay() && Date.now() < deadline) {
			await setImmediate();
		}
		assert(tui.hasOverlay(), "Settings must open before the question arrives");
		settings = tui.getFocusedComponent();
		assert(
			settings && settings !== editor,
			"Settings must have keyboard focus"
		);
		tui.renderNow();
	});
	pi.events.on("herdr:blocked", (payload) => {
		if (!((payload as { active: boolean }).active && settings)) {
			return;
		}
		// Let Pi mount the question (or leave it waiting) before sending Escape.
		setImmediate()
			.then(async () => {
				tui.renderNow();
				tui.handleTerminalInput("\u001b");
				if (tui.hasOverlay()) {
					// In the broken run the question was cancelled; leave the settings
					// open so the trace and terminal output retain the failure.
					return;
				}
				tui.renderNow();
				await setImmediate();
				tui.renderNow();
				tui.handleTerminalInput("1");
				tui.handleTerminalInput("\r");
			})
			.catch((error: unknown) => {
				throw error;
			});
	});
}
