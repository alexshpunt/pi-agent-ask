import type { Component, TUI } from "@earendil-works/pi-tui";

export type LinkedHost = TUI & {
	layoutRoot: Component;
	handleTerminalInput(data: string): void;
};

type Document = Component & {
	pane: string;
	beginFrame(): void;
	searchEntries(): Array<{ text: string }>;
};

/** Read the real mounted Stereo documents without changing its source or native history. */
export function captureLinkedViews(host: LinkedHost) {
	const panes: Record<string, string[]> = {};
	const search: Record<string, string[]> = {};
	const seen = new Set<Component>();
	const pending: Component[] = [host.layoutRoot];
	while (pending.length) {
		const component = pending.pop();
		if (!component || seen.has(component)) {
			continue;
		}
		seen.add(component);
		if (component.constructor.name === "NativeDocument") {
			const document = component as Document;
			document.beginFrame();
			panes[document.pane] = document.render(160);
			search[document.pane] = document
				.searchEntries()
				.map((entry) => entry.text);
			continue;
		}
		const owner = component as Component & {
			children?: Component[];
			child?: Component;
		};
		pending.push(...(owner.children ?? []));
		if (owner.child) {
			pending.push(owner.child);
		}
	}
	return { panes, search };
}
