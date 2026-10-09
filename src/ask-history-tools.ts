import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	hasCommittedAnswer,
	readAskHistory,
	selectAskHistory,
} from "./ask-history.ts";
import { exportAskHistory } from "./ask-history-export.ts";
import {
	HistoryKeySchema,
	type HistoryRecord,
	HistoryRecordSchema,
} from "./ask-history-schema.ts";

const ListItemSchema = Type.Object({
	...Type.Pick(HistoryRecordSchema, [
		"requestId",
		"questionId",
		"title",
		"createdAt",
		"background",
		"status",
		"mode",
	]).properties,
	label: Type.String(),
	prompt: Type.String(),
	hasAnswer: Type.Boolean(),
});
const ListParamsSchema = Type.Object({
	query: Type.Optional(
		Type.String({
			description:
				"Case-insensitive text search in recorded questions, options, answers, and notes.",
		})
	),
	answeredOnly: Type.Optional(
		Type.Boolean({
			description:
				"Only questions with a committed answer; clarification may still be pending.",
		})
	),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});

function invisible() {
	return {
		invalidate() {
			/* Nothing is rendered. */
		},
		render: () => [] as string[],
	};
}
function response<T>(data: T) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data) }],
		details: data,
		structuredContent: data,
	};
}
function records(ctx: ExtensionContext) {
	return readAskHistory(ctx.sessionManager.getBranch());
}
function summary(record: HistoryRecord) {
	const {
		question,
		answer,
		elaboration: _elaboration,
		error: _error,
		...rest
	} = record;
	return {
		...rest,
		label: question.label,
		prompt: question.prompt,
		hasAnswer: hasCommittedAnswer(answer),
	};
}

/** Register three agent-callable tools with intentionally empty native TUI rows. */
export function registerAskHistoryTools(pi: ExtensionAPI): void {
	const renderers = {
		renderShell: "self" as const,
		renderCall: invisible,
		renderResult: invisible,
	};
	pi.registerTool({
		name: "list_ask_history",
		label: "List Ask History",
		description:
			"Find ask_user questions and outcomes recorded on the active session branch, including ancestors. Survives compaction, reload, and resume. Returns requestId + questionId keys, compact summaries, total, and nextOffset for paging. Does not include other branches, other sessions, ordinary chat, or command replay.",
		parameters: ListParamsSchema,
		outputSchema: Type.Object({
			total: Type.Integer(),
			offset: Type.Integer(),
			nextOffset: Type.Optional(Type.Integer()),
			records: Type.Array(ListItemSchema),
		}),
		annotations: { readOnlyHint: true, openWorldHint: false },
		...renderers,
		execute(_id, params, _signal, _update, ctx) {
			const query = params.query?.trim().toLowerCase();
			const matches = records(ctx).filter(
				(record) =>
					(!params.answeredOnly || hasCommittedAnswer(record.answer)) &&
					(!query || JSON.stringify(record).toLowerCase().includes(query))
			);
			const offset = params.offset ?? 0;
			const page = matches.slice(offset, offset + (params.limit ?? 50));
			const next = offset + page.length;
			return Promise.resolve(
				response({
					total: matches.length,
					offset,
					...(next < matches.length ? { nextOffset: next } : {}),
					records: page.map(summary),
				})
			);
		},
	});
	pi.registerTool({
		name: "read_ask_history",
		label: "Read Ask History",
		description:
			"Read one recorded ask_user question by requestId + questionId from list_ask_history or ask_user. Returns the full saved prompt, options and previews, answer, notes, and outcome. Missing or out-of-branch keys fail explicitly. Waiting, skipped, cancelled, or clarification outcomes are not approval.",
		parameters: HistoryKeySchema,
		outputSchema: Type.Object({ record: HistoryRecordSchema }),
		annotations: { readOnlyHint: true, openWorldHint: false },
		...renderers,
		execute(_id, key, _signal, _update, ctx) {
			const [record] = selectAskHistory(records(ctx), [key]);
			return Promise.resolve(response({ record }));
		},
	});
	pi.registerTool({
		name: "export_ask_history",
		label: "Export Ask History",
		description:
			"Export recorded ask_user questions and outcomes to a NEW Markdown file at path. Omit keys for the full current-branch journal or supply requestId + questionId pairs for an exact selection. Preserves saved wording without rewriting. Validates all keys before writing; never overwrites existing files or follows destination symlinks. Returns saved path and exported keys. Does not tell the agent where to use the export.",
		parameters: Type.Object({
			path: Type.String({ minLength: 1 }),
			keys: Type.Optional(Type.Array(HistoryKeySchema, { minItems: 1 })),
		}),
		outputSchema: Type.Object({
			path: Type.String(),
			keys: Type.Array(HistoryKeySchema),
		}),
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		...renderers,
		async execute(_id, params, _signal, _update, ctx) {
			const selected = selectAskHistory(records(ctx), params.keys);
			return response(await exportAskHistory(params.path, ctx.cwd, selected));
		},
	});
}
