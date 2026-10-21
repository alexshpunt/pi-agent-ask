import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { restoreQueuedRequests } from "../../src/background-ask-state.ts";
import { waitForEditor } from "../../src/ui/wait-for-editor.ts";
import { captureLinkedViews, type LinkedHost } from "./linked-answer-view.ts";

/** Real command-driven reload/tree changes, never session-file rewriting. */
// biome-ignore lint/style/noDefaultExport: Pi loads extension fixtures through a default factory.
export default function linkedAnswerLifecycle(pi: ExtensionAPI): void {
	let host: LinkedHost | undefined;
	let stopWaiting: (() => void) | undefined;
	const record = async (phase: string, ctx: ExtensionContext) => {
		assert(host);
		const file = process.env.ASK_LIFECYCLE_CAPTURE;
		assert(file);
		const saved = JSON.parse(await readFile(file, "utf8"));
		saved[phase] = {
			sessionFile: ctx.sessionManager.getSessionFile(),
			leafId: ctx.sessionManager.getLeafId(),
			...captureLinkedViews(host),
			requests: restoreQueuedRequests(ctx.sessionManager.getBranch()),
		};
		await writeFile(file, JSON.stringify(saved));
	};
	pi.on("session_start", (event, ctx) => {
		ctx.ui.setWidget("ask-test:lifecycle-host", (tui) => {
			host = tui as LinkedHost;
			return new Text("", 0, 0);
		});
		if (event.reason === "reload") {
			stopWaiting = waitForEditor(ctx, () => {
				stopWaiting = undefined;
				assert(host);
				host.handleTerminalInput("/ask-linked-branch");
				host.handleTerminalInput("\r");
			});
		}
	});
	pi.on("session_shutdown", () => stopWaiting?.());
	pi.registerCommand("ask-linked-reload", {
		description:
			"Check resumed Ask cards, then reload their real extension runtime.",
		handler: async (_args, ctx) => {
			await record("resumed", ctx);
			await ctx.reload();
		},
	});
	pi.registerCommand("ask-linked-branch", {
		description:
			"Navigate a real session tree and check branch-owned answer cards.",
		handler: async (_args, ctx) => {
			await record("reloaded", ctx);
			const target = process.env.ASK_LIFECYCLE_BRANCH;
			assert(target);
			await ctx.navigateTree(target, { summarize: false });
			await record("branched", ctx);
			pi.sendUserMessage(
				"Finish the Ask lifecycle verification and check the empty wait."
			);
		},
	});
	pi.on("agent_before_settle", (_event, ctx) => record("finished", ctx));
}
