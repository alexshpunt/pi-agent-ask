import { withImageMarker } from "../images.ts";
import type {
	AskAnswerImages,
	AskDisplayOption,
	AskImage,
	AskResultAnswer,
	AskSelectedOption,
	AskStateAnswer,
} from "../types.ts";

export interface ExtraOptionNote {
	label: string;
	note: string;
}

/** Whether a custom row has text or images, selected or not. */
export function hasCustomAnswer(answer: AskStateAnswer | undefined): boolean {
	return !!(answer?.customText?.trim() || answer?.customImages?.length);
}

function hasImages(answer: AskAnswerImages): boolean {
	return !!(
		answer.customImages?.length ||
		answer.noteImages?.length ||
		Object.keys(answer.optionNoteImages ?? {}).length
	);
}

export function cloneAnswerImages(answer: AskAnswerImages): AskAnswerImages {
	const copy = (images: AskImage[]) => images.map((image) => ({ ...image }));
	const optionImages = Object.entries(answer.optionNoteImages ?? {}).filter(
		([, images]) => images.length
	);
	return {
		...(answer.customImages?.length
			? { customImages: copy(answer.customImages) }
			: {}),
		...(answer.noteImages?.length
			? { noteImages: copy(answer.noteImages) }
			: {}),
		...(optionImages.length
			? {
					optionNoteImages: Object.fromEntries(
						optionImages.map(([value, images]) => [value, copy(images)])
					),
				}
			: {}),
	};
}
export function emptyAnswer(): AskStateAnswer {
	return { selected: [] };
}

export function cloneAnswer(answer: AskStateAnswer): AskStateAnswer {
	return {
		...cloneAnswerImages(answer),
		selected: answer.selected.map(cloneSelection),
		customSelected: answer.customSelected,
		customText: answer.customText,
		note: answer.note,
		optionNotes: answer.optionNotes ? { ...answer.optionNotes } : undefined,
	};
}

export function cloneResultAnswer(answer: AskResultAnswer): AskResultAnswer {
	return {
		...cloneAnswerImages(answer),
		values: [...answer.values],
		labels: [...answer.labels],
		indices: [...answer.indices],
		customText: answer.customText,
		note: answer.note,
		optionNotes: answer.optionNotes ? { ...answer.optionNotes } : undefined,
	};
}

export function toggleSelection(
	answer: AskStateAnswer,
	option: AskDisplayOption,
	index: number
): AskStateAnswer {
	const next = cloneAnswer(answer);
	const selectedIndex = next.selected.findIndex(
		(selection) => selection.value === option.value
	);

	if (selectedIndex >= 0) {
		next.selected.splice(selectedIndex, 1);
		return next;
	}

	next.selected.push({
		value: option.value,
		label: option.label,
		index: index + 1,
	});
	return next;
}

export function setSingleSelection(
	answer: AskStateAnswer,
	option: AskDisplayOption,
	index: number
): AskStateAnswer {
	return {
		...emptyAnswer(),
		...cloneAnswerImages({
			noteImages: answer.noteImages,
			optionNoteImages: answer.optionNoteImages,
		}),
		note: answer.note,
		optionNotes: answer.optionNotes ? { ...answer.optionNotes } : undefined,
		selected: [
			{
				value: option.value,
				label: option.label,
				index: index + 1,
			},
		],
	};
}

export function saveCustomText(
	answer: AskStateAnswer,
	rawValue: string,
	mode: "single" | "multi"
): AskStateAnswer {
	const trimmed = rawValue.trim();
	const next = cloneAnswer(answer);
	if (mode === "single") {
		next.selected = [];
	}
	if (!(trimmed || next.customImages?.length)) {
		next.customSelected = undefined;
		next.customText = undefined;
		return next;
	}
	next.customSelected = true;
	next.customText = trimmed ? rawValue : undefined;
	return next;
}

export function setCustomSelected(
	answer: AskStateAnswer,
	selected: boolean
): AskStateAnswer {
	const next = cloneAnswer(answer);
	next.customSelected = selected || undefined;
	return next;
}

export function saveQuestionNote(
	answer: AskStateAnswer,
	rawValue: string
): AskStateAnswer {
	const next = cloneAnswer(answer);
	if (rawValue.trim()) {
		next.note = rawValue;
		return next;
	}
	next.note = undefined;
	return next;
}

export function saveOptionNote(
	answer: AskStateAnswer,
	optionValue: string,
	rawValue: string
): AskStateAnswer {
	const next = cloneAnswer(answer);
	const optionNotes = { ...(next.optionNotes ?? {}) };
	if (rawValue.trim()) {
		optionNotes[optionValue] = rawValue;
	} else {
		delete optionNotes[optionValue];
	}
	next.optionNotes =
		Object.keys(optionNotes).length > 0 ? optionNotes : undefined;
	return next;
}

export function isAnswerEmpty(answer: AskStateAnswer): boolean {
	return (
		answer.selected.length === 0 &&
		!answer.customText &&
		!hasImages(answer) &&
		!answer.note &&
		(!answer.optionNotes || Object.keys(answer.optionNotes).length === 0)
	);
}

export function isAnswerAnswered(answer?: AskStateAnswer): boolean {
	if (!answer) {
		return false;
	}
	return (
		answer.selected.length > 0 ||
		!!(answer.customSelected && hasCustomAnswer(answer))
	);
}

export function hasAnswerNotes(answer?: AskStateAnswer): boolean {
	return !!(
		answer?.note ||
		answer?.optionNotes ||
		answer?.noteImages?.length ||
		Object.keys(answer?.optionNoteImages ?? {}).length
	);
}

export function isResultAnswerEmpty(answer: AskResultAnswer): boolean {
	return (
		answer.values.length === 0 &&
		answer.labels.length === 0 &&
		answer.indices.length === 0 &&
		!answer.customText &&
		!hasImages(answer) &&
		!answer.note &&
		(!answer.optionNotes || Object.keys(answer.optionNotes).length === 0)
	);
}

export function isResultAnswerCommitted(answer: AskResultAnswer): boolean {
	return (
		answer.values.length > 0 ||
		answer.labels.length > 0 ||
		answer.indices.length > 0 ||
		!!answer.customText ||
		!!answer.customImages?.length
	);
}

export function isCustomOnlyAnswer(answer: AskResultAnswer): boolean {
	return (
		answer.indices.length === 0 &&
		!!(answer.customText || answer.customImages?.length)
	);
}

export function isOptionSelected(
	answer: AskStateAnswer | undefined,
	optionValue: string
): boolean {
	return !!answer?.selected.some(
		(selection) => selection.value === optionValue
	);
}

export function serializeAnswer(answer: AskStateAnswer): AskResultAnswer {
	const selectedCustomText = answer.customSelected
		? answer.customText
		: undefined;
	const values = [
		...answer.selected.map((selection) => selection.value),
		...(selectedCustomText ? [selectedCustomText] : []),
	];
	const labels = [
		...answer.selected.map((selection) => selection.label),
		...(selectedCustomText ? [selectedCustomText] : []),
	];
	const indices = answer.selected.map((selection) => selection.index);
	const selectedNotes = answer.optionNotes
		? Object.fromEntries(
				answer.selected
					.map((selection) => [
						selection.value,
						answer.optionNotes?.[selection.value],
					])
					.filter((entry): entry is [string, string] => !!entry[1])
			)
		: undefined;

	return {
		...cloneAnswerImages({
			customImages: answer.customSelected ? answer.customImages : undefined,
			noteImages: answer.noteImages,
			optionNoteImages: Object.fromEntries(
				answer.selected.flatMap(({ value }) =>
					answer.optionNoteImages?.[value]?.length
						? [[value, answer.optionNoteImages[value]]]
						: []
				)
			),
		}),
		values,
		labels,
		indices,
		customText: selectedCustomText,
		note: answer.note,
		optionNotes:
			selectedNotes && Object.keys(selectedNotes).length > 0
				? selectedNotes
				: undefined,
	};
}

export function getExtraOptionNotes(args: {
	answer: AskStateAnswer;
	questionOptions: Array<{ value: string; label: string }>;
	selectedValues?: Iterable<string>;
}): ExtraOptionNote[] {
	const selectedValues = new Set(args.selectedValues ?? []);
	return [
		...new Set([
			...Object.keys(args.answer.optionNotes ?? {}),
			...Object.keys(args.answer.optionNoteImages ?? {}),
		]),
	]
		.filter((value) => !selectedValues.has(value))
		.map((value) => {
			const note = withImageMarker(
				args.answer.optionNotes?.[value],
				args.answer.optionNoteImages?.[value]
			);
			const option = args.questionOptions.find(
				(candidate) => candidate.value === value
			);
			return option && note ? { label: option.label, note } : undefined;
		})
		.filter((entry): entry is ExtraOptionNote => Boolean(entry));
}

function cloneSelection(selection: AskSelectedOption): AskSelectedOption {
	return { ...selection };
}
