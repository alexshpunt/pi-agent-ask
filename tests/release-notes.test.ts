import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "../scripts/release-notes.ts";

const MISSING_SECTION_RE = /no section for 9\.9\.9/;
const EMPTY_SECTION_RE = /section for 3\.0\.0 is empty/;

const changelog = `# [2.0.0](https://example.com/compare) (2026-10-24)

### Breaking changes

- New thing.

# [1.2.11](https://example.com/compare) (2026-10-23)

- Older thing.
`;

test("release notes contain only the requested CHANGELOG section and install links", () => {
	const notes = releaseNotes(changelog, "2.0.0");
	assert(notes.startsWith("### Breaking changes\n\n- New thing."));
	assert(!notes.includes("Older thing"));
	assert(notes.includes("pi install npm:pi-agent-ask"));
	assert(notes.includes("https://www.npmjs.com/package/pi-agent-ask/v/2.0.0"));
});

test("the last CHANGELOG section ends at the end of the file", () => {
	assert(releaseNotes(changelog, "1.2.11").startsWith("- Older thing."));
});

test("a missing or empty CHANGELOG section stops the release", () => {
	assert.throws(() => releaseNotes(changelog, "9.9.9"), MISSING_SECTION_RE);
	assert.throws(
		() => releaseNotes("# [3.0.0](x) (date)\n\n# [2.0.0](x)\n- a", "3.0.0"),
		EMPTY_SECTION_RE
	);
});
