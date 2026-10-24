import assert from "node:assert/strict";
import test from "node:test";
import {
	getReviewShortcutHint,
	resolveReviewShortcutDoublePress,
} from "../src/ui/review-shortcuts.ts";

const DIGIT_THREE = /3/;
const CANCEL = /Cancel/;

test("review shortcut double press requires the same digit twice", () => {
	const first = resolveReviewShortcutDoublePress(2);
	assert.equal(first.confirmed, false);
	assert.equal(first.actionIndex, 1);
	assert.equal(first.pendingActionIndex, 1);

	const second = resolveReviewShortcutDoublePress(2, first.pendingActionIndex);
	assert.equal(second.confirmed, true);
	assert.equal(second.actionIndex, 1);
	assert.equal(second.pendingActionIndex, undefined);
});

test("review shortcut double press switches pending action when digit changes", () => {
	const first = resolveReviewShortcutDoublePress(1);
	const second = resolveReviewShortcutDoublePress(2, first.pendingActionIndex);

	assert.equal(second.confirmed, false);
	assert.equal(second.actionIndex, 1);
	assert.equal(second.pendingActionIndex, 1);
});

test("review shortcut ignores digits beyond Submit and Cancel", () => {
	for (const pending of [undefined, 2]) {
		assert.deepEqual(resolveReviewShortcutDoublePress(3, pending), {
			confirmed: false,
		});
	}
});

test("review shortcut hint offers only the existing actions", () => {
	assert.doesNotMatch(getReviewShortcutHint(), DIGIT_THREE);
	assert.match(getReviewShortcutHint(1), CANCEL);
});
