import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskConfigStore } from "./config/store.ts";

export type AskModeScope = "global" | "project";
type ModeContext = Pick<
	ExtensionContext,
	"cwd" | "hasUI" | "isProjectTrusted"
> & {
	ui: Pick<ExtensionContext["ui"], "confirm" | "notify">;
};
type ProjectConfig = Record<string, unknown> & {
	behaviour?: Record<string, unknown> & { backgroundOnly?: boolean };
};

export function getProjectAskConfigPath(cwd: string): string {
	return join(cwd, ".pi", "extensions", "pi-agent-ask.json");
}

/** Owns the effective policy; config changes reach tools only after user consent. */
export class AskModeController {
	backgroundOnly = false;
	private projectOverride?: boolean;
	private modelRequested = false;
	private changing = false;
	private generation = 0;
	private readonly store: AskConfigStore;
	private readonly onChange: (backgroundOnly: boolean) => void;

	constructor(
		store: AskConfigStore,
		onChange: (backgroundOnly: boolean) => void
	) {
		this.store = store;
		this.onChange = onChange;
	}

	async initialize(ctx: ModeContext): Promise<void> {
		const generation = ++this.generation;
		this.modelRequested = false;
		let projectOverride: boolean | undefined;
		const config = await this.store.getConfig();
		if (ctx.isProjectTrusted()) {
			try {
				projectOverride = (await readProjectConfig(ctx.cwd)).behaviour
					?.backgroundOnly;
			} catch (error) {
				if (generation !== this.generation) {
					return;
				}
				ctx.ui.notify(
					`${error instanceof Error ? error.message : String(error)} Using the global ask mode.`,
					"warning"
				);
			}
		}
		if (generation !== this.generation) {
			return;
		}
		this.projectOverride = projectOverride;
		this.apply(projectOverride ?? config.behaviour.backgroundOnly);
	}

	endSession(): void {
		this.generation += 1;
	}

	markModelRequest(): void {
		this.modelRequested = true;
	}

	async changeMode(
		scope: AskModeScope,
		value: boolean | undefined,
		ctx: ModeContext
	): Promise<boolean> {
		if (this.changing) {
			throw new Error("Another ask mode change is in progress.");
		}
		if (scope === "project" && !ctx.isProjectTrusted()) {
			throw new Error(
				"Project ask mode requires a trusted project. Use /trust first."
			);
		}
		if (scope === "global" && value === undefined) {
			throw new Error("Only a project can inherit the global ask mode.");
		}
		this.changing = true;
		try {
			return await this.saveChange(scope, value, ctx, this.generation);
		} finally {
			this.changing = false;
		}
	}

	private async saveChange(
		scope: AskModeScope,
		value: boolean | undefined,
		ctx: ModeContext,
		generation: number
	): Promise<boolean> {
		const config = await this.store.getConfig();
		const project =
			scope === "project" ? await readProjectConfig(ctx.cwd) : undefined;
		const enabled =
			scope === "project"
				? (value ?? config.behaviour.backgroundOnly)
				: (this.projectOverride ?? Boolean(value));
		if (!(await this.confirmChange(enabled, ctx))) {
			return false;
		}
		this.assertCurrentSession(generation);
		if (project) {
			const next = {
				...project,
				behaviour: { ...project.behaviour, backgroundOnly: value },
			};
			const path = getProjectAskConfigPath(ctx.cwd);
			await mkdir(dirname(path), { recursive: true });
			this.assertCurrentSession(generation);
			await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		} else {
			await this.store.save({
				...config,
				behaviour: { ...config.behaviour, backgroundOnly: Boolean(value) },
			});
		}
		this.assertCurrentSession(generation);
		if (scope === "project") {
			this.projectOverride = value;
		}
		this.apply(enabled);
		return true;
	}

	private assertCurrentSession(generation: number): void {
		if (generation !== this.generation) {
			throw new Error("Ask mode change cancelled because the session changed.");
		}
	}

	private confirmChange(enabled: boolean, ctx: ModeContext): Promise<boolean> {
		if (enabled === this.backgroundOnly || !this.modelRequested) {
			return Promise.resolve(true);
		}
		if (!ctx.hasUI) {
			return Promise.reject(
				new Error(
					"Changing ask mode after a model request requires interactive user confirmation."
				)
			);
		}
		return ctx.ui.confirm(
			"Change ask mode?",
			"This changes ask_user and wait_for_answers tool definitions and may invalidate the model's prompt cache. Continue?"
		);
	}
	private apply(enabled: boolean): void {
		if (enabled === this.backgroundOnly) {
			return;
		}
		this.backgroundOnly = enabled;
		this.onChange(enabled);
	}
}

async function readProjectConfig(cwd: string): Promise<ProjectConfig> {
	const path = getProjectAskConfigPath(cwd);
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return {};
		}
		throw error;
	}
	const parsed: unknown = JSON.parse(content);
	if (
		!isRecord(parsed) ||
		(parsed.behaviour !== undefined && !isRecord(parsed.behaviour))
	) {
		throw new Error(`Invalid project ask config at ${path}.`);
	}
	const behaviour = parsed.behaviour as Record<string, unknown> | undefined;
	if (
		behaviour?.backgroundOnly !== undefined &&
		typeof behaviour.backgroundOnly !== "boolean"
	) {
		throw new Error(`behaviour.backgroundOnly must be a boolean in ${path}.`);
	}
	return parsed as ProjectConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
