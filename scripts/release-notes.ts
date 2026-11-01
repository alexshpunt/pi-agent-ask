import { readFileSync } from "node:fs";

const HEADING = /^# \[([^\]]+)\]/;

/** Return the CHANGELOG section for one version, followed by install instructions. */
export function releaseNotes(changelog: string, version: string): string {
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version);
	if (start < 0) {
		throw new Error(`CHANGELOG.md has no section for ${version}`);
	}
	const next = lines.findIndex(
		(line, index) => index > start && HEADING.test(line)
	);
	const section = lines
		.slice(start + 1, next < 0 ? undefined : next)
		.join("\n")
		.trim();
	if (!section) {
		throw new Error(`CHANGELOG.md section for ${version} is empty`);
	}
	return [
		section,
		"Install or update with:",
		"```sh\npi install npm:pi-agent-ask\n```",
		`Available on [npm](https://www.npmjs.com/package/pi-agent-ask/v/${version}).`,
	].join("\n\n");
}

if (import.meta.main) {
	const version = process.argv[2];
	if (!version) {
		throw new Error("Usage: node scripts/release-notes.ts <version>");
	}
	process.stdout.write(
		`${releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version)}\n`
	);
}
