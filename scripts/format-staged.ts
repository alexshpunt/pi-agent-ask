import {
	type SpawnSyncOptionsWithBufferEncoding,
	spawnSync,
} from "node:child_process";
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function git(args: string[], options?: SpawnSyncOptionsWithBufferEncoding) {
	const result = spawnSync(
		"git",
		["--no-optional-locks", "-c", "core.quotePath=true", ...args],
		{ maxBuffer: 64 * 1024 * 1024, ...options }
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(result.stderr.toString().trimEnd() || "Git failed");
	}
	return result.stdout;
}

function records(output: Buffer) {
	return new TextDecoder("utf-8", {
		fatal: true,
		// biome-ignore lint/style/useNamingConvention: TextDecoder option name.
		ignoreBOM: true,
	})
		.decode(output)
		.split("\0")
		.slice(0, -1);
}

const stagedRegularFile = /^:\d+ 100(?:644|755) /;
const contextRegularFile = /^100(?:644|755) [0-9a-f]+ 0$/;

function stagedFiles() {
	// Treat renames as additions plus deletions; format only new regular files.
	const entries = records(
		git([
			"diff",
			"--cached",
			"--raw",
			"-z",
			"--no-renames",
			"--diff-filter=AMT",
			"--",
		])
	);
	return entries.filter(
		(_, i) => i % 2 === 1 && stagedRegularFile.test(entries[i - 1] ?? "")
	);
}

function formattingContext() {
	return records(
		git([
			"ls-files",
			"--stage",
			"-z",
			"--",
			":(glob)**/biome.json",
			":(glob)**/biome.jsonc",
			":(glob)**/.editorconfig",
		])
	).flatMap((entry) => {
		const tab = entry.indexOf("\t");
		return contextRegularFile.test(entry.slice(0, tab))
			? [entry.slice(tab + 1)]
			: [];
	});
}

function format(snapshot: string) {
	const biome = fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome"));
	// Biome's configuration extends the locally installed Ultracite preset.
	symlinkSync(
		path.resolve("node_modules"),
		path.join(snapshot, "node_modules"),
		"junction"
	);
	const result = spawnSync(
		process.execPath,
		[
			biome,
			"format",
			"--write",
			"--no-errors-on-unmatched",
			"--files-ignore-unknown=true",
			"--config-path=.",
			".",
		],
		{ cwd: snapshot, stdio: "inherit" }
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error("Biome could not format the staged snapshot");
	}
}

const missingFileErrors = new Set(["ENOENT", "ENOTDIR"]);

function hasUnstagedBytes(file: string, snapshot: string) {
	try {
		return !(
			lstatSync(file).isFile() &&
			readFileSync(file).equals(readFileSync(path.join(snapshot, file)))
		);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			missingFileErrors.has(String(error.code))
		) {
			return true;
		}
		throw error;
	}
}

function formattingPatch(snapshot: string) {
	// Commit hooks can receive a relative path to a temporary index, e.g. with
	// git commit -a. Resolve it before Git switches to the snapshot work tree.
	const index = git([
		"rev-parse",
		"--path-format=absolute",
		"--git-path",
		"index",
	])
		.toString()
		.slice(0, -1);
	return git(
		[
			`--work-tree=${snapshot}`,
			"-c",
			"core.filemode=false",
			"diff",
			"--diff-filter=M",
			"--binary",
			"--full-index",
			"--no-renames",
			"--no-ext-diff",
			"--no-textconv",
			"--no-color",
			"--no-relative",
			"--src-prefix=a/",
			"--dst-prefix=b/",
			"--",
		],
		{
			env: {
				...process.env,
				// biome-ignore lint/style/useNamingConvention: Git environment variable.
				GIT_INDEX_FILE: index,
			},
		}
	);
}

const apply = [
	"-c",
	"apply.ignoreWhitespace=no",
	"apply",
	"--whitespace=nowarn",
];

function applyFormatting(snapshot: string, unstaged: string[]) {
	const patch = formattingPatch(snapshot);
	if (patch.length === 0) {
		return;
	}

	// Exclude partially staged paths from the worktree patch entirely, even
	// when their unstaged edits do not overlap the formatting changes.
	for (const file of unstaged) {
		rmSync(path.join(snapshot, file));
	}
	const worktreePatch =
		unstaged.length === 0 ? patch : formattingPatch(snapshot);

	git([...apply, "--cached", "-"], { input: patch });
	if (worktreePatch.length > 0) {
		try {
			git([...apply, "-"], { input: worktreePatch });
		} catch (error) {
			console.warn("Formatting staged; working copy left unchanged:", error);
		}
	}
}

function main() {
	const files = new Set(stagedFiles());
	if (files.size === 0) {
		return;
	}

	const context = formattingContext();
	const snapshot = mkdtempSync(path.join(tmpdir(), "ask-format-staged-"));
	try {
		git(["checkout-index", `--prefix=${snapshot}/`, "--stdin", "-z"], {
			input: `${[...new Set([...files, ...context])].join("\0")}\0`,
		});
		const unstaged = [...files].filter((file) =>
			hasUnstagedBytes(file, snapshot)
		);
		format(snapshot);
		// Context-only files must never contribute to the formatting patch.
		for (const file of context) {
			if (!files.has(file)) {
				rmSync(path.join(snapshot, file));
			}
		}
		applyFormatting(snapshot, unstaged);
	} finally {
		rmSync(snapshot, { recursive: true, force: true });
	}
}

try {
	main();
} catch (error) {
	console.error(
		`Could not format staged files: ${error instanceof Error ? error.message : String(error)}`
	);
	process.exitCode = 1;
}
