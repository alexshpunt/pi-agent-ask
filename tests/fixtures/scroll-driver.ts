import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STEP_MS = 400;

// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function scrollDriver(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (tui, theme, keys, done) => {
				const component = await factory(tui, theme, keys, done);
				const frames: Record<string, unknown> = {};
				const columns = tui.terminal.columns;
				const snapshot = (name: string) => {
					const lines = component.render(columns);
					frames[name] = { rows: tui.terminal.rows, columns, lines };
				};
				const steps: [string, () => void][] = [
					["initial", () => undefined],
					["pageDown", () => component.handleInput?.("\u001b[6~")],
					["pageDown2", () => component.handleInput?.("\u001b[6~")],
					["pageUp", () => component.handleInput?.("\u001b[5~")],
					[
						"wheel",
						() =>
							component.handleMouse?.({
								type: "wheel",
								button: "none",
								x: columns - 10,
								y: 12,
								screenX: columns - 10,
								screenY: 12,
								width: columns,
								height: tui.terminal.rows,
								shift: false,
								alt: false,
								ctrl: false,
								wheelDelta: 5,
							}),
					],
					["accept", () => component.handleInput?.("\r")],
				];
				let delay = STEP_MS;
				for (const [name, run] of steps) {
					setTimeout(() => {
						run();
						snapshot(name);
						tui.requestRender();
						if (name === "accept") {
							writeFileSync(
								join(ctx.cwd, "scroll-frames.json"),
								JSON.stringify(frames)
							);
						}
					}, delay);
					delay += STEP_MS;
				}
				return component;
			}, options);
	});
}
