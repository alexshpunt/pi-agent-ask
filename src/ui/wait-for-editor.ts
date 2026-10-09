import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const READY_WIDGET = "ask:queue-ready";

/** Start after the native editor is back, not while a lifecycle loading screen owns its slot. */
export function waitForEditor(
	ctx: ExtensionContext,
	ready: () => void
): () => void {
	let stopped = false;
	let scheduled = false;
	const stop = () => {
		stopped = true;
		ctx.ui.setWidget(READY_WIDGET, undefined);
	};
	ctx.ui.setWidget(READY_WIDGET, (tui) => ({
		render() {
			if (!(stopped || scheduled) && containsEditor(tui)) {
				scheduled = true;
				queueMicrotask(() => {
					if (stopped) {
						return;
					}
					stop();
					ready();
				});
			}
			return [];
		},
		invalidate: () => undefined,
	}));
	return stop;
}

/** Recognize a native editor through its public text methods and container children. */
export function containsEditor(component: unknown): boolean {
	if (typeof component !== "object" || component === null) {
		return false;
	}
	if (
		"getText" in component &&
		typeof component.getText === "function" &&
		"setText" in component &&
		typeof component.setText === "function"
	) {
		return true;
	}
	return (
		"children" in component &&
		Array.isArray(component.children) &&
		component.children.some(containsEditor)
	);
}
