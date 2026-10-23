import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import { createInitialState } from "../src/state/create.ts";
import {
	applyNumberShortcut,
	confirmCurrentSelection,
	moveTab,
	saveCustomAnswer,
	toggleCurrentOption,
} from "../src/state/transitions.ts";
import { runAskFlow } from "../src/ui/controller.ts";

function params() {
	return {
		questions: ["first", "last"].map((id) => ({
			id,
			prompt: `Pick ${id}`,
			type: "multi" as const,
			options: [{ value: "a", label: "A" }],
		})),
	};
}

for (const tab of [0, 1]) {
	test(`Enter on saved custom multi answer advances from question ${tab + 1}`, () => {
		let state = createInitialState(params());
		if (tab) {
			state = moveTab(state, tab);
		}
		state = toggleCurrentOption(state);
		state = applyNumberShortcut(state, 2);
		state = saveCustomAnswer(state, "Custom answer");
		const answers = state.answers;

		state = confirmCurrentSelection(state);

		assert.equal(state.activeTabIndex, tab + 1);
		assert.equal(state.view.kind, tab === 0 ? "navigate" : "submit");
		assert.deepEqual(state.answers, answers);
		assert.equal(state.completed, false);
	});
}

for (const custom of [false, true]) {
	test(`Space toggles and Enter advances both multi questions${custom ? " with custom text" : ""}`, async () => {
		getAskConfigStore().setConfig({
			...DEFAULT_ASK_CONFIG,
			notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
		});
		let component:
			| {
					handleInput(data: string): void;
					dispose(): void;
					render(width: number): string[];
			  }
			| undefined;
		const abort = new AbortController();
		const running = runAskFlow(
			{
				cwd: process.cwd(),
				mode: "tui",
				abort() {
					// Cleanup uses the explicit test signal, not an agent operation.
				},
				ui: {
					custom(factory: (...args: unknown[]) => unknown) {
						return new Promise((resolve) => {
							component = factory(
								{
									requestRender() {
										// Assertions render the component synchronously.
									},
								},
								{
									fg: (_color: string, text: string) => text,
									bg: (_color: string, text: string) => text,
								},
								{ matches: () => false, getKeys: () => [] },
								(result: unknown) => {
									component?.dispose();
									resolve(result);
								}
							) as typeof component;
						});
					},
				},
			} as never,
			params(),
			{ signal: abort.signal }
		);
		try {
			await new Promise((resolve) => setImmediate(resolve));
			assert(component);
			for (const id of ["first", "last"]) {
				component.handleInput(" ");
				assert(component.render(100).join("\n").includes(`Pick ${id}`));
				component.handleInput(" ");
				component.handleInput(" ");
				if (custom) {
					component.handleInput("2");
					component.handleInput("Custom answer");
				}
				component.handleInput("\r");
				const rendered = component.render(100).join("\n");
				assert(
					rendered.includes(id === "first" ? "Pick last" : "1. Submit"),
					`Enter did not leave ${id}:\n${rendered}`
				);
			}
			component.handleInput("\r");
			const result = await running;
			for (const id of ["first", "last"]) {
				assert.deepEqual(
					result.answers[id].values,
					custom ? ["a", "Custom answer"] : ["a"]
				);
				assert.equal(
					result.answers[id].customText,
					custom ? "Custom answer" : undefined
				);
			}
		} finally {
			abort.abort();
			await running;
			getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
		}
	});
}
