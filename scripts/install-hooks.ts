import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const hook = `#!/bin/sh
# pi-agent-ask pre-commit hook
# The hook is shared by worktrees; older branches may not have the script.
if [ -f scripts/format-staged.ts ]; then
  exec node scripts/format-staged.ts
fi
`;

function git(...args: string[]) {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.error) {
		throw result.error;
	}
	return result;
}

function install() {
	// Archives and package consumers need no Git hook. Do not install into a
	// parent checkout if this package is nested inside an unrelated repository.
	if (!existsSync(".git")) {
		return;
	}
	if (git("config", "--get", "core.hooksPath").status === 0) {
		console.warn(
			"Custom core.hooksPath set; run node scripts/format-staged.ts from your pre-commit hook."
		);
		return;
	}

	const result = git(
		"rev-parse",
		"--path-format=absolute",
		"--git-path",
		"hooks/pre-commit"
	);
	if (result.status !== 0) {
		throw new Error(result.stderr.trimEnd());
	}
	const destination = result.stdout.slice(0, -1);
	mkdirSync(path.dirname(destination), { recursive: true });
	try {
		writeFileSync(destination, hook, { flag: "wx", mode: 0o755 });
	} catch (error) {
		if (
			!(error instanceof Error && "code" in error && error.code === "EEXIST")
		) {
			throw error;
		}
		// An existing hook may be user-managed. Never overwrite it.
	}
}

install();
