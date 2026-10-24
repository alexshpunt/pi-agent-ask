import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { AskQueuedSchema } from "../../src/background-ask-state.ts";
import { getAskConfigStore } from "../../src/config/store.ts";
import { AskResultSchema } from "../../src/result-schema.ts";

interface Form {
	handleInput?(data: string): void;
	render(width: number): string[];
}
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function until(form: Form, expected: string): Promise<string> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const screen = form.render(120).join("\n");
		if (
			screen.includes(expected) &&
			!screen.includes("Reading image clipboard")
		) {
			return screen;
		}
		await pause();
	}
	throw new Error(
		`Image editor never showed ${expected}: ${form.render(120).join("\n")}`
	);
}

async function attachCustomImages(
	form: Form,
	paste: string,
	screens: string[]
): Promise<void> {
	form.handleInput?.("2");
	process.env.PI_ASK_TEST_CLIPBOARD = "empty";
	form.handleInput?.(paste);
	screens.push(await until(form, "No image in the clipboard"));
	process.env.PI_ASK_TEST_CLIPBOARD = "unavailable";
	form.handleInput?.(paste);
	screens.push(await until(form, "Image clipboard is unavailable"));
	process.env.PI_ASK_TEST_CLIPBOARD = "image";
	form.handleInput?.(paste);
	screens.push(await until(form, "[1 image]"));
	form.handleInput?.(paste);
	screens.push(await until(form, "[2 images]"));
	form.handleInput?.("\x1b\x04");
	screens.push(await until(form, "[1 image]"));
	form.handleInput?.("\r");
	screens.push(await until(form, "1. Submit"));
	// Enter advances multi answers; return to the saved custom row before adding notes.
	form.handleInput?.("\x1b[D");
	form.handleInput?.("\x1b[B");
}
async function attachNote(
	form: Form,
	paste: string,
	open: string,
	text: string
): Promise<void> {
	form.handleInput?.(open);
	form.handleInput?.(`\x1b[200~${text}\x1b[201~`);
	form.handleInput?.(paste);
	await until(form, "[1 image]");
	form.handleInput?.("\r");
}
async function submitImageForm(
	form: Form,
	paste: string,
	noteUnselectedOption: boolean,
	screens: string[]
): Promise<void> {
	await attachCustomImages(form, paste, screens);
	await attachNote(form, paste, "N", "Question text");
	// Moving up leaves "Yes" unselected; "1" selects it before noting it.
	form.handleInput?.(noteUnselectedOption ? "\x1b[A" : "1");
	await attachNote(form, paste, "n", "Option text");
	form.handleInput?.("\t");
	screens.push(form.render(120).join("\n"));
	form.handleInput?.("\r");
}
// biome-ignore lint/style/noDefaultExport: Pi loads fixture extensions through a default factory.
export default function imageDriver(pi: ExtensionAPI): void {
	let background = false;
	let noteUnselectedOption = false;
	let answer: (() => Promise<void>) | undefined;
	const requests = new Map<string, string>();
	const observations: Record<string, string[]> = {};
	let currentId = "";
	pi.on("tool_call", (event) => {
		if (event.toolName === "ask_user") {
			background = event.input.background === true;
			noteUnselectedOption = event.input.title === "unselected";
			currentId = event.toolCallId;
		}
		if (event.toolName === "wait_for_answers") {
			setImmediate(() => {
				answer?.();
			});
		}
		if (event.toolName === "read_ask_history") {
			event.input.requestId =
				requests.get(String(event.input.requestId)) ?? event.input.requestId;
		}
	});
	pi.on("tool_result", (event) => {
		if (
			event.toolName === "ask_user" &&
			(Value.Check(AskQueuedSchema, event.details) ||
				Value.Check(AskResultSchema, event.details)) &&
			event.details.requestId
		) {
			requests.set(event.toolCallId, event.details.requestId);
		}
	});
	pi.on("session_start", async () => {
		// History tools are opt-in; this scenario reads and exports history.
		const store = getAskConfigStore();
		const config = await store.getConfig();
		await store.save({
			...config,
			behaviour: { ...config.behaviour, historyTools: true },
		});
	});
	pi.on("session_start", (_event, ctx) => {
		let panel: Component | undefined;
		const setWidget = ctx.ui.setWidget.bind(ctx.ui);
		ctx.ui.setWidget = (key, content, options) => {
			if (key === "ask:active-surface" && typeof content === "function") {
				setWidget(
					key,
					(tui, theme) => {
						panel = content(tui, theme);
						return panel;
					},
					options
				);
				return;
			}
			if (key === "ask:active-surface" && content === undefined) {
				panel = undefined;
			}
			if (typeof content === "function") {
				setWidget(key, content, options);
			} else {
				setWidget(key, content, options);
			}
		};
		const custom = ctx.ui.custom.bind(ctx.ui);
		ctx.ui.custom = (factory, options) =>
			custom(async (...args) => {
				const component = await factory(...args);
				// Background forms render in the widget, not the keyboard overlay.
				const visible = panel ?? component;
				const form: Form = {
					handleInput: (data) => component.handleInput?.(data),
					render: (width) => visible.render(width),
				};
				const id = currentId;
				const unselected = noteUnselectedOption;
				const keys = args[2].getKeys("app.clipboard.pasteImage");
				const paste = keys.includes("alt+v") ? "\x1bv" : "\x16";
				const drive = async () => {
					const screens: string[] = [];
					try {
						if (id === "abort") {
							await attachCustomImages(form, paste, screens);
							ctx.abort();
						} else {
							await submitImageForm(form, paste, unselected, screens);
						}
					} catch (error) {
						screens.push(`FAIL: ${String(error)}`);
						pi.appendEntry("image-driver-failure", {
							error: String(error),
							screens,
						});
						pi.sendMessage({
							customType: "image-driver-failure",
							content: String(error),
							display: true,
						});
						form.handleInput?.("\x03");
						form.handleInput?.("\x03");
					}
					observations[id] = screens;
					await writeFile(
						join(ctx.cwd, "image-editor-observations.json"),
						JSON.stringify(observations)
					);
				};
				let running: Promise<void> | undefined;
				answer = () => (running ??= drive());
				if (!background) {
					setImmediate(() => {
						answer?.();
					});
				}
				return component;
			}, options);
	});
	pi.registerTool({
		name: "image_probe",
		label: "Image Probe",
		description: "Submit the pending image form and observe the editor.",
		parameters: Type.Object({}),
		async execute() {
			await answer?.();
			return {
				content: [{ type: "text", text: "Image form submitted." }],
				details: {},
			};
		},
	});
}
