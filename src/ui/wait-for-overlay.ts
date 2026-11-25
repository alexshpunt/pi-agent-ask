import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const OVERLAY_WAIT_WIDGET = "ask:overlay-wait";

function isOverlayFocused(tui: TUI): boolean {
	// Pi exposes overlay visibility publicly, but its focus query is protected.
	// A passive visible overlay must not delay the form.
	const host = tui as TUI & { isOverlayFocused?: () => boolean };
	return host.isOverlayFocused?.() === true;
}

/** Wait before Pi mounts an editor-slot dialog, which would take keyboard focus. */
export function waitForOverlay(
	ui: ExtensionContext["ui"],
	tui: TUI,
	signal?: AbortSignal
): Promise<void> | undefined {
	if (!isOverlayFocused(tui)) {
		return;
	}
	return new Promise((resolve, reject) => {
		signal?.throwIfAborted();
		let waiting = true;
		let scheduled = false;
		const cleanup = () => {
			waiting = false;
			signal?.removeEventListener("abort", abort);
			ui.setWidget(OVERLAY_WAIT_WIDGET, undefined);
		};
		const abort = () => {
			cleanup();
			reject(signal?.reason);
		};
		ui.setWidget(OVERLAY_WAIT_WIDGET, () => ({
			render() {
				if (waiting && !scheduled && !isOverlayFocused(tui)) {
					scheduled = true;
					// Wait until Pi finishes rendering before removing the widget.
					queueMicrotask(() => {
						scheduled = false;
						if (waiting && !isOverlayFocused(tui)) {
							cleanup();
							resolve();
						}
					});
				}
				return [];
			},
			invalidate: () => undefined,
		}));
		signal?.addEventListener("abort", abort, { once: true });
	});
}
