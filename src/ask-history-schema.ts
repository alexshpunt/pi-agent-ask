import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { QueuedAnswerSchema } from "./background-ask-state.ts";
import { AnswerSchema, AskResultSchema } from "./result-schema.ts";
import { AskQuestionSchema } from "./schema.ts";

const QuestionType = StringEnum(["single", "multi", "preview"] as const);
export const HistoryQuestionSchema = Type.Object({
	...AskQuestionSchema.properties,
	label: Type.String(),
	type: QuestionType,
	presentedType: Type.Optional(QuestionType),
});
export const HistoryRequestSchema = Type.Object({
	version: Type.Literal(1),
	requestId: Type.String(),
	toolCallId: Type.String(),
	title: Type.Optional(Type.String()),
	background: Type.Boolean(),
	createdAt: Type.String(),
	questions: Type.Array(HistoryQuestionSchema),
});
export const HistoryCompletionSchema = Type.Object({
	version: Type.Literal(1),
	...QueuedAnswerSchema.properties,
});

/** Address one question within a generated, session-backed request. */
export const HistoryKeySchema = Type.Object({
	requestId: Type.String({ minLength: 1 }),
	questionId: Type.String({ minLength: 1 }),
});
/** Full recorded question, its latest outcome, and only its own answer and notes. */
export const HistoryRecordSchema = Type.Object({
	...HistoryKeySchema.properties,
	title: Type.Optional(Type.String()),
	background: Type.Boolean(),
	createdAt: Type.String(),
	question: HistoryQuestionSchema,
	status: StringEnum([
		"waiting",
		"answered",
		"skipped",
		"cancelled",
		"clarification",
		"error",
	] as const),
	mode: Type.Optional(AskResultSchema.properties.mode),
	answer: Type.Optional(AnswerSchema),
	elaboration: Type.Optional(
		AskResultSchema.properties.elaboration.properties.items
	),
	error: Type.Optional(Type.String()),
});
export type HistoryKey = Static<typeof HistoryKeySchema>;
export type HistoryRecord = Static<typeof HistoryRecordSchema>;
export type HistoryRequest = Static<typeof HistoryRequestSchema>;
export type HistoryCompletion = Static<typeof HistoryCompletionSchema>;
