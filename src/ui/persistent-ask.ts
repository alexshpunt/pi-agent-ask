import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import type { AskResult } from "../types.ts";
import { containsEditor } from "./wait-for-editor.ts";

type CustomArgs = Parameters<Parameters<ExtensionContext["ui"]["custom"]>[0]>;
type AskComponent = Component & Partial<Focusable> & { dispose?(): void };
type AskFactory = (
	tui: CustomArgs[0],
	theme: CustomArgs[1],
	keys: CustomArgs[2],
	done: (result: AskResult) => void
) => AskComponent;

const SURFACE_WIDGET = "ask:active-surface";

/** Remount the same background controller if lifecycle cleanup replaces its editor slot. */
export async function showPersistentAsk(
	ctx: ExtensionContext,
	factory: AskFactory
): Promise<AskResult> {
	let component: AskComponent | undefined;
	let result: AskResult | undefined;
	let close: ((value: AskResult | undefined) => void) | undefined;
	let disposed = false;
	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		component?.dispose?.();
	};
	const surface: AskComponent = {
		get focused() {
			return component?.focused ?? false;
		},
		set focused(value: boolean) {
			if (component) {
				component.focused = value;
			}
		},
		render: (width) => component?.render(width) ?? [],
		invalidate: () => component?.invalidate(),
		handleInput: (data) => component?.handleInput?.(data),
		dispose() {
			if (result) {
				dispose();
			}
		},
	};
	try {
		while (!result) {
			const completed = await ctx.ui.custom<AskResult | undefined>(
				(tui, theme, keys, done) => {
					close = done;
					if (!component) {
						component = factory(tui, theme, keys, (answer) => {
							result = answer;
							close?.(answer);
						});
						ctx.ui.setWidget(SURFACE_WIDGET, () => ({
							render() {
								if (
									!result &&
									close &&
									containsEditor(tui) &&
									!contains(tui, surface)
								) {
									const detach = close;
									close = undefined;
									queueMicrotask(() => detach(undefined));
								}
								return [];
							},
							invalidate: () => undefined,
						}));
					}
					return surface;
				}
			);
			if (completed) {
				result = completed;
			}
		}
		return result;
	} finally {
		ctx.ui.setWidget(SURFACE_WIDGET, undefined);
		dispose();
	}
}

function contains(tree: unknown, target: Component): boolean {
	if (tree === target) {
		return true;
	}
	return (
		typeof tree === "object" &&
		tree !== null &&
		"children" in tree &&
		Array.isArray(tree.children) &&
		tree.children.some((child) => contains(child, target))
	);
}
