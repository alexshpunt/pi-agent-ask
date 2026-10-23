import { execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TUI,
	type TuiMouseEvent,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	PI_ASK_COMPLETED_EVENT,
	type RemoteAskCompletedEvent,
} from "../../src/remote-ask.ts";

async function input(data: string): Promise<void> {
	process.stdin.emit("data", data);
	await new Promise<void>((resolve) => setImmediate(resolve));
}

// biome-ignore lint/style/noDefaultExport: Pi loads this isolated test driver by default export.
export default function mouseDriver(pi: ExtensionAPI): void {
	let panel: Component | undefined;
	let tui: TUI | undefined;
	let lines: string[] = [];
	let lastMouse: TuiMouseEvent | undefined;
	let lastEditorMouse: TuiMouseEvent | undefined;
	let painted: (() => void) | undefined;
	const completed: RemoteAskCompletedEvent[] = [];
	pi.events.on(PI_ASK_COMPLETED_EVENT, (event) =>
		completed.push(event as RemoteAskCompletedEvent)
	);
	pi.on("session_start", (_event, ctx) => {
		const setWidget = ctx.ui.setWidget.bind(ctx.ui);
		ctx.ui.setWidget = (key, content, options) => {
			if (typeof content !== "function") {
				if (key === "ask:active-surface") {
					panel = undefined;
				}
				setWidget(key, content, options);
				return;
			}
			if (key !== "ask:active-surface") {
				setWidget(key, content, options);
				return;
			}
			setWidget(
				key,
				(nativeTui: TUI, theme: Theme) => {
					tui = nativeTui;
					const editor = (
						nativeTui as TUI & { getFocusedComponent(): Component | null }
					).getFocusedComponent();
					if (editor) {
						const handleMouse = editor.handleMouse?.bind(editor);
						editor.handleMouse = (event) => {
							lastEditorMouse = event;
							return handleMouse?.(event);
						};
					}
					const child = content(nativeTui, theme);
					panel = {
						render(width) {
							lines = child.render(width);
							painted?.();
							return lines;
						},
						invalidate: () => child.invalidate(),
						handleMouse(event) {
							lastMouse = event;
							return child.handleMouse?.(event);
						},
					};
					return panel;
				},
				options
			);
		};
	});

	async function paint(): Promise<void> {
		if (!panel) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("The real questionnaire did not render")),
				2000
			);
			painted = () => {
				clearTimeout(timeout);
				painted = undefined;
				resolve();
			};
			tui?.requestRender();
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
	}

	async function locate(): Promise<{ x: number; y: number }> {
		await paint();
		if (tui?.mode !== "fullscreen") {
			throw new Error(
				`Mouse verification requires native fullscreen, got ${tui?.mode}`
			);
		}
		for (let y = 0; y < tui.terminal.rows; y += 1) {
			lastMouse = undefined;
			await input(`\u001b[<35;2;${y + 1}M`);
			const observed = lastMouse as TuiMouseEvent | undefined;
			if (observed?.type === "move" && observed.y === 0) {
				return { x: observed.screenX - observed.x, y: observed.screenY };
			}
		}
		throw new Error(
			"Native mouse motion never reached the visible question widget"
		);
	}

	async function clickLabel(label: string): Promise<void> {
		const origin = await locate();
		let row = -1;
		for (let attempt = 0; attempt < 30; attempt += 1) {
			row = lines.findIndex((line) =>
				stripVTControlCharacters(line).includes(label)
			);
			if (row >= 0) {
				break;
			}
			await input(`\u001b[<65;${origin.x + 2};${origin.y + 2}M`);
			await paint();
		}
		if (row < 0) {
			throw new Error(`Visible mouse target not found: ${label}`);
		}
		const plain = stripVTControlCharacters(lines[row]);
		const x = origin.x + visibleWidth(plain.slice(0, plain.indexOf(label))) + 1;
		const y = origin.y + row;
		await input(`\u001b[<0;${x + 1};${y + 1}M`);
		await input(`\u001b[<0;${x + 1};${y + 1}m`);
		await paint();
	}

	async function dragOption(): Promise<void> {
		const origin = await locate();
		const row = lines.findIndex((line) =>
			stripVTControlCharacters(line).includes("2. Second choice")
		);
		if (row < 0) {
			throw new Error("The drag target is not visible");
		}
		const x = origin.x + 4;
		const y = origin.y + row + 1;
		await input(`\u001b[<0;${x};${y}M`);
		await input(`\u001b[<32;${x + 3};${y}M`);
		await input(`\u001b[<0;${x + 3};${y}m`);
		await paint();
		if (
			!lines.some((line) =>
				stripVTControlCharacters(line).includes("Pick by mouse")
			)
		) {
			throw new Error("Dragging submitted an answer");
		}
	}

	async function checkModalFocus(): Promise<void> {
		await input("?");
		await paint();
		await input("\u001b[27u");
		await paint();
		await input("1");
		await paint();
		if (
			!lines.some((line) =>
				stripVTControlCharacters(line).includes("1. [x] Choice 1")
			)
		) {
			throw new Error(
				"Closing settings did not return keyboard focus to the questionnaire"
			);
		}
		await input("1");
		await paint();
	}
	async function returnToEditor(): Promise<void> {
		await paint();
		let origin: TuiMouseEvent | undefined;
		for (let y = 0; y < (tui?.terminal.rows ?? 0); y += 1) {
			lastEditorMouse = undefined;
			await input(`\u001b[<35;2;${y + 1}M`);
			const observed = lastEditorMouse as TuiMouseEvent | undefined;
			if (observed?.type === "move" && observed.y === 0) {
				origin = observed;
				break;
			}
		}
		if (!origin) {
			throw new Error("Native mouse motion did not reach the ordinary editor");
		}
		const x = origin.screenX + 1;
		const y = origin.screenY + 2;
		await input(`\u001b[<0;${x};${y}M`);
		await input(`\u001b[<0;${x};${y}m`);
		await input("\u001b[F");
		await input("\u001b[200~-back-to-editor\u001b[201~");
		await paint();
	}
	async function resize(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const onResize = () => {
				clearTimeout(timeout);
				resolve();
			};
			const timeout = setTimeout(() => {
				process.stdout.off("resize", onResize);
				reject(new Error("The owned mouse-test terminal did not resize"));
			}, 2000);
			process.stdout.once("resize", onResize);
			try {
				const size = process.env.ASK_TEST_STEREO_EXTENSION
					? ["120", "40"]
					: ["60", "18"];
				execFileSync("stty", ["cols", size[0], "rows", size[1]], {
					stdio: ["inherit", "pipe", "pipe"],
				});
			} catch (error) {
				clearTimeout(timeout);
				process.stdout.off("resize", onResize);
				reject(error);
			}
		});
		await paint();
	}
	pi.registerTool({
		name: "mouse_probe",
		label: "Mouse Probe",
		description:
			"Click the actual native question widget through terminal mouse reports.",
		parameters: Type.Object({ action: Type.String() }),
		async execute(_id, { action }, _signal, _update, ctx) {
			switch (action) {
				case "draft":
					await input("\u001b[200~ordinary-mouse-draft\u001b[201~");
					break;
				case "drag":
					await dragOption();
					break;
				case "modal_focus":
					await checkModalFocus();
					break;
				case "editor_focus":
					await returnToEditor();
					break;
				case "resize":
					await resize();
					break;
				case "single":
					await clickLabel("2. Second choice");
					if (
						!lines.some((line) =>
							stripVTControlCharacters(line).includes(
								"Pick two distant choices"
							)
						)
					) {
						throw new Error(
							"The native click did not select the second answer"
						);
					}
					break;
				case "multi": {
					await clickLabel("12. [ ] Choice 12");
					await clickLabel("13. [ ] Choice 13");
					const origin = await locate();
					for (let index = 0; index < 15; index += 1) {
						await input(`\u001b[<64;${origin.x + 2};${origin.y + 2}M`);
						await paint();
					}
					await clickLabel("☰ Review");
					break;
				}
				case "submit":
					await clickLabel("1. Submit");
					await clickLabel("1. Submit");
					await input("\u001b[200~-after-click\u001b[201~");
					break;
				default:
					throw new Error(`Unknown mouse action: ${action}`);
			}
			const details = {
				normalInput: ctx.ui.getEditorText(),
				terminalSize: {
					cols: process.stdout.columns,
					rows: process.stdout.rows,
				},
				panel: stripVTControlCharacters(lines.join("\n")),
				completed: [...completed],
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
