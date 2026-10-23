import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AskModeController, AskModeScope } from "./ask-mode.ts";

const USAGE =
	"Usage: /ask-mode [global|project] [normal|background-only|inherit]. Only projects can inherit.";
const WHITESPACE = /\s+/;
const CHOICES = [
	{ name: "normal", label: "Normal", value: false },
	{ name: "background-only", label: "Background-only", value: true },
	{ name: "inherit", label: "Inherit global", value: undefined },
] as const;

interface ModeSelection {
	scope: AskModeScope;
	value: boolean | undefined;
}

export function registerAskModeCommand(
	pi: ExtensionAPI,
	mode: AskModeController
): void {
	pi.registerCommand("ask-mode", {
		description:
			"Choose normal or background-only questions globally or for a trusted project",
		handler: async (args, ctx) => {
			try {
				await runModeCommand(args, ctx, mode);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error"
				);
			}
		},
	});
}

async function runModeCommand(
	args: string,
	ctx: ExtensionCommandContext,
	mode: AskModeController
): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/ask-mode requires interactive TUI mode.", "error");
		return;
	}
	const selection = args.trim() ? parseMode(args) : await selectMode(ctx);
	if (!selection) {
		return;
	}
	if (!(await mode.changeMode(selection.scope, selection.value, ctx))) {
		ctx.ui.notify("Ask mode unchanged.", "info");
		return;
	}
	const current = mode.backgroundOnly ? "background-only" : "normal";
	const saved = selection.value === undefined ? "inheritance" : "setting";
	ctx.ui.notify(
		`Ask mode: ${current}. Saved ${selection.scope} ${saved}.`,
		"info"
	);
}

function parseMode(args: string): ModeSelection {
	const [scope, name, extra] = args.trim().split(WHITESPACE);
	const choice = CHOICES.find((candidate) => candidate.name === name);
	if ((scope !== "global" && scope !== "project") || !choice || extra) {
		throw new Error(USAGE);
	}
	if (scope === "global" && choice.value === undefined) {
		throw new Error(USAGE);
	}
	return { scope, value: choice.value };
}

async function selectMode(
	ctx: ExtensionCommandContext
): Promise<ModeSelection | undefined> {
	const selected = await ctx.ui.select("Change ask mode", [
		"Global default",
		"Project override",
	]);
	if (!selected) {
		return;
	}
	const scope = selected === "Global default" ? "global" : "project";
	const choices = scope === "project" ? CHOICES : CHOICES.slice(0, 2);
	const label = await ctx.ui.select(
		"Question mode",
		choices.map((choice) => choice.label)
	);
	const choice = choices.find((candidate) => candidate.label === label);
	return choice ? { scope, value: choice.value } : undefined;
}
