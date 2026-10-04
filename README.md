![pi-ask main image](docs/media/pi-ask-main.png)

# @alexshpunt/pi-ask

## Herdr support fork

This fork adds Herdr blocked-state reporting to pi-ask 1.2.0. The fix comes from
[maudelv's branch](https://github.com/maudelv/pi-ask/tree/feat/herdr-blocked-state),
with the original commit authors preserved. See [upstream issue #14](https://github.com/eko24ive/pi-ask/issues/14).

Install this fork instead of the upstream npm or git package:

```bash
pi remove npm:@eko24ive/pi-ask
pi remove git:github.com/alexshpunt/pi-ask@main
pi install npm:@alexshpunt/pi-ask
```

Then run `/reload` or restart Pi. Remove any separate pi-ask-to-Herdr bridge to
avoid sending the blocked signal twice. Your existing pi-ask settings still apply.
The tool name, settings file, and inter-extension event names stay the same as upstream.
Releases publish to npm from version tags such as `v1.2.1` after CI checks.

[![npm downloads](https://badgen.net/npm/dm/@alexshpunt/pi-ask)](https://www.npmjs.com/package/@alexshpunt/pi-ask)
[![last commit](https://badgen.net/github/last-commit/alexshpunt/pi-ask)](https://github.com/alexshpunt/pi-ask/commits/main)
[![stars](https://badgen.net/github/stars/alexshpunt/pi-ask)](https://github.com/alexshpunt/pi-ask/stargazers)

> [!IMPORTANT]
> Contributions are welcome in chill mode: please open an issue and link your fork or branch instead of expecting rapid pull-request reviews.

`@eko24ive/pi-ask` is an ask tool that cares about your answers.

It lets an agent pause, ask structured questions in a terminal UI, and continue with normalized answers instead of guessing.

![pi-ask demo](docs/media/pi-ask-demo.gif)

High-quality video: [demo.mp4](https://github.com/user-attachments/assets/a8503ca9-afcb-4c31-9edc-353b985a0209)

## Contributions: chill mode

This open source project is something I care about, and it genuinely brings me joy to see it help people. That said, I cannot promise rapid reviews or a normal pull-request turnaround.

If you have an idea, bug report, or change, please open an issue. If you already have code, link to your fork or branch with the changes. I will review it carefully when I have time, then either incorporate the forked changes or implement the idea myself.

I value contributions and will do my best to credit the people who help, whether that means a shout-out, a co-authored commit, or another fitting form of attribution.

## Install

```bash
pi install npm:@alexshpunt/pi-ask
```

You can also install from git:

```bash
pi install git:github.com/eko24ive/pi-ask
```

Or try it without installing (load once for the current run):

```bash
pi -e npm:@eko24ive/pi-ask
```

## Features

Once installed, this package gives the agent a native way to ask for clarification instead of guessing.

- 🧭 Familiar ask-style interface: tabbed questions, single/multi select, and preview mode
- ⭐ Optional warning-colored `(recommended)` markers that do not preselect answers
- ✍️ Inline free-form `Type your own` answers
- 📎 Native pi-style `@` file references inside answer and note editors
- 📝 Question-level and option-level notes
- 👀 Review tab with `Submit`, `Elaborate`, and `Cancel`
- 💬 Elaboration flow to capture note-based clarification before final submission
- ⌨️ Context-aware customizable keymaps with aliases for main flow, editors, and settings
- ⚙️ Ask settings with persisted behaviour, notifications, keymaps, and `/answer` extraction config
- 🔔 Optional external notifications when an ask flow is waiting for input
- 🔁 Slash commands for fallback/replay:
  - `/answer` extracts questions from the latest assistant message into an ask flow
  - `/answer:again` reopens the latest `/answer` form on the current branch
  - `/ask:replay` replays the latest real `ask_user` form on the current branch
- 🛟 Automatic recovery of an unanswered `ask_user` form after startup, resume, or fork
- 🗣️ You can talk to your agent to configure pi-ask; it will read the bundled configuration guide and tailor the config for you

Development checks: `pnpm test`, `pnpm typecheck`, and `pnpm test:integration`. The integration check requires Pi on PATH and the test harness's native `node-pty` build.

## External UI adapters

A trusted Pi bridge can connect a browser or another UI to foreground `ask_user` calls in RPC and other non-TUI modes. The original call waits for the answer; pi-ask validates and returns its normal result. The terminal UI stays unchanged.

Load both pi-ask and the bridge extension. The bridge owns connection checks, rendering, and transport. pi-ask does not include a BB plugin or a universal TUI-to-browser renderer. Without a supported connection, the existing non-TUI fallback still applies; background questions and replay are not routed externally.

See [the adapter contract](docs/remote-events.md#external-ui-negotiation).

## Ask while you work

Set `background: true` on the usual `ask_user` payload to queue a form and receive its request ID immediately. Keep doing independent research while the user answers. Forms open automatically, one at a time.

Each completed form reaches the agent between turns, without waiting for the rest of the queue. When no independent work remains, call `wait_for_answers({})` directly. It waits without a built-in timeout and returns answers not already delivered as messages.

Never treat a queued receipt, cancellation, or empty wait result as approval. Do not make decisions that depend on unanswered questions. The queue follows the active session branch and survives reload/resume. See [the contract](docs/contract.md#background-queue).

## Feature walkthrough

### Native `@` file references
Use pi-style `@` file path autocomplete inside free-form answers and note editors.

![Native pi-style @ file references inside the ask flow](docs/media/feature-at-file-mentions.png)

### Option and question notes
Attach clarification notes to a specific option (`n`) or add broader question-level context (`Shift+N`).

| Option notes | Question notes |
|---|---|
| ![Option note editor with note text for selected option](docs/media/feature-option-note.png) | ![Question-level note editor with saved note](docs/media/feature-question-note.png) |

### Review tab — Elaborate and Submit
Ask the agent to elaborate on notes before finalizing choices, or review all answers before returning them to the agent.

| Elaborate | Submit |
|---|---|
| ![Review tab with Elaborate action and expanded note preview](docs/media/feature-review-elaborate.png) | ![Review tab with Submit action highlighted](docs/media/feature-review-submit.png) |

### Single-select and multi-select questions
Pick one option when answers are mutually exclusive, or choose multiple options when several answers apply.

| Single-select | Multi-select |
|---|---|
| ![Single-select question with one selected option](docs/media/feature-single-select.png) | ![Multi-select question with multiple selected options](docs/media/feature-multi-select.png) |

### Preview mode
Use a dedicated preview pane when options need richer detail.

Pass inline `preview` text or a local UTF-8 file path in `previewFile`:

```json
{
  "value": "proposal",
  "label": "Proposal",
  "previewFile": "docs/proposal.md"
}
```

Use this option in a `type: "preview"` question. Paths are absolute or relative to
Pi’s working directory. Do not combine `preview` and `previewFile` on one option.
Missing, unreadable, empty, or non-text files return an error before the form opens.
The file text appears in the preview pane, not in the option label. Replay uses
the saved text from the original call. Markdown is shown as plain text.

![Preview question showing a dedicated preview pane](docs/media/feature-preview-pane.png)

### Custom answer (`Type your own`)
Capture free-form input inline without leaving the flow.

![Inline custom answer input for Type your own option](docs/media/feature-custom-answer-input.png)

## Default key bindings

Open ask settings with `?` during the ask flow, or with the `/ask-settings` command from pi.

Keymaps are context-aware and configurable in `~/.pi/agent/extensions/eko24ive-pi-ask.json`.
Each action accepts a key string or an array of aliases.

Default contexts:

- `global`: `dismiss` (`Ctrl+C`) and `settings` (`?`)
- `main`: confirm/cancel/toggle, tab navigation, option navigation, and note shortcuts
- `editor`: custom answer submit/close and empty-editor navigation
- `noteEditor`: note save/close and empty-editor navigation
- `settingsModal`: close, next/previous setting, and toggle

Fixed bindings:

| Key | Context | Effect |
|---|---|---|
| `1..9` | Options list | Select or toggle matching option |
| `1` `2` `3` | Review tab | Trigger `Submit` / `Elaborate` / `Cancel` |
| `@` | Editors | File-reference affordance |
| Arrow keys / `Tab` | Non-empty editor | Stay in editor for cursor movement |

Review-tab shortcuts can optionally require the same number key twice via `behaviour.doublePressReviewShortcuts`. `behaviour.presentSingleAsMulti` can render future single-select questions as multi-select while preserving the requested type in results; use `main.changeQuestionType` (`t` by default) to change the active question type live.

You can edit the config file yourself, ask pi to edit it for you, or use `/ask-settings` to find the exact config path, toggle behaviour/notification settings, or reset config to defaults with a guarded double press. pi-ask treats the config file as user-owned: load-time migrations and invalid files are handled in memory without rewriting or backing up the file, and read-only/externally managed configs fail gracefully with a manual-edit message.

`/answer` keeps extraction within the current session model scope. Check a configured model before use with `pi auth check --provider <provider> --model <id>`.

```json
{
  "schemaVersion": 5,
  "answer": {
    "extractionModels": [
      { "provider": "openai-codex", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini" },
      { "provider": "anthropic", "id": "claude-haiku-4-5" }
    ],
    "extractionTimeoutMs": 30000,
    "extractionRetries": 1
  },
  "behaviour": {
    "autoSubmitWhenAnsweredWithoutNotes": false,
    "confirmDismissWhenDirty": true,
    "doublePressReviewShortcuts": true,
    "presentSingleAsMulti": false,
    "showFooterHints": true
  },
  "keymaps": {
    "global": { "dismiss": ["ctrl+c"], "settings": ["?"] },
    "main": {
      "confirm": ["enter"],
      "cancel": ["esc"],
      "toggle": ["space"],
      "changeQuestionType": ["t"],
      "nextTab": ["tab", "right"],
      "previousTab": ["shift+tab", "left"],
      "nextOption": ["down"],
      "previousOption": ["up"],
      "optionNote": ["n"],
      "questionNote": ["shift+n"]
    },
    "editor": {
      "submit": ["enter"],
      "close": ["esc"],
      "nextTabWhenEmpty": ["tab", "right"],
      "previousTabWhenEmpty": ["shift+tab", "left"],
      "nextOptionWhenEmpty": ["down"],
      "previousOptionWhenEmpty": ["up"]
    },
    "noteEditor": {
      "save": ["enter"],
      "close": ["esc"],
      "nextTabWhenEmpty": ["tab", "right"],
      "previousTabWhenEmpty": ["shift+tab", "left"],
      "nextOptionWhenEmpty": ["down"],
      "previousOptionWhenEmpty": ["up"]
    },
    "settingsModal": {
      "close": ["esc", "ctrl+c", "?"],
      "nextOption": ["down"],
      "previousOption": ["up"],
      "toggle": ["enter", "space"]
    }
  },
  "notifications": {
    "enabled": true,
    "channels": ["bell"]
  }
}
```

Accepted notation follows pi-tui key ids. Common aliases are normalized, for example `escape` → `esc`, `return` → `enter`, `control+c` → `ctrl+c`, and `Shift+N` → `shift+n`.

## Use

After installation, the extension registers the `ask_user` tool plus `/ask-settings`, `/answer`, `/answer:again`, and `/ask:replay` commands.

Agents can auto-discover and call `ask_user` when they need clarification instead of guessing. They can mark any number of grounded preferences with `recommended: true` and use option descriptions for reasons. In interactive sessions, it opens a terminal UI flow for structured answers, supports native pi-style `@` file references while typing answers or notes, and returns normalized answers back to the agent. Ask settings are available both from `?` in the ask flow and from the `/ask-settings` command. Behaviour and notification settings are binary `on`/`off` toggles that save immediately when the config file is writable; save failures revert the toggle and show a manual-edit message. The settings overlay includes a guarded double-press reset-to-defaults action; keymaps, notification channels, and extraction settings are changed by editing the shown config file path.

Cancelling the whole form with Escape stops the current agent operation, including for background forms. Escape inside an editor or settings only closes that editor or settings; dirty-dismiss confirmation still applies.

### Structured results in Codemode

Use Pi 1.0.0 or newer for structured tool results. A Codemode call returns the
`AskResult` object directly, including `answers`, `cancelled`, `mode`, and optional
`error`, `continuation`, and `elaboration` fields:

```js
const result = await tools.ask_user({
  questions: [{
    id: "choice",
    prompt: "Choose a document",
    type: "preview",
    options: [{ value: "proposal", label: "Proposal", previewFile: "docs/proposal.md" }]
  }]
});
text(result.answers.choice?.values ?? []);
```

Check `result.cancelled` and `result.error` before using answers. Ordinary tool
calls still show a short text summary.

### Herdr multiplexer status

While any interactive ask form is waiting for input, pi-ask emits the local
`herdr:blocked` event with `{ active: true, label: "Waiting for user response" }`.
It emits `{ active: false }` after answer, cancellation, abort, timeout, or error.
The Herdr event contains no question, context, answer, or note data. Hosts without
an event listener are unaffected.

Background forms report the same blocked status without pausing independent agent work. Cancelling a background form never starts a new agent turn.

### Answer and replay commands

`/answer` is useful when the agent asked questions in plain text instead of using `ask_user`. It extracts questions from the latest completed assistant message and opens the same ask UI.

Replay commands are branch-aware. They read persisted entries from the current pi session branch, so they work naturally with `/resume`, `/tree`, and conversation branching:

- `/answer:again` reopens the latest form created by `/answer` on this branch
- `/ask:replay` reopens the latest real `ask_user` form on this branch

Cancellation is local to the UI: closing a replayed form does not start a new agent turn. Submitted answers are sent back as a normal user follow-up message.

### Interrupted ask forms

If Pi stops while an `ask_user` form is open, the tool call remains without a result. Starting, resuming, or forking that session reopens the newest unanswered form once. Submitting sends the result as a user message because the original tool execution no longer exists. Cancelling dismisses the automatic recovery. Either outcome prevents another automatic reopen, while `/ask:replay` remains available.

New sessions and extension reloads do not trigger recovery.

Kudos to [@k0valik](https://github.com/k0valik) for the `/answer` idea.

You can also talk to pi to configure this extension. When asked to customize pi-ask settings, keymaps, notifications, or extraction behavior, the agent is instructed to read the bundled `docs/configuration.md` guide first and then edit the config file accordingly.

This package also bundles the `ask-user` skill profile from `skills/ask-user/SKILL.md`. It reinforces when to use the tool, is enabled by default when installed, and can be disabled via `pi config`. The skill was inspired by https://github.com/edlsh/pi-ask-user.

You can still add your own agent instruction if you want to further reinforce usage.

For exact input/output and UX guarantees, see [`docs/contract.md`](docs/contract.md).

## Local development

### Run locally in pi

```bash
pi -e ./src/index.ts
```

### Run in isolated test mode (extension + bundled skill only)

```bash
pnpm dev
pnpm dev ../test
```

`pnpm dev [path]` runs pi with `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files`, loads this repo’s extension and `skills/ask-user`, and starts pi from `[path]` by changing directories before launch (defaults to `.`).

### Install dependencies

```bash
pnpm install
```

### Install git hooks (contributors)

`lefthook` is not installed automatically. If you want the local commit hooks used by this repo, run:

```bash
pnpm exec lefthook install
```

### Development commands

```bash
pnpm format
pnpm lint
pnpm check
pnpm typecheck
pnpm test
```

### Commit workflow

This repo uses `lefthook`, Commitizen, conventional commitlint, and semantic-release.

If you want local hooks, install them once after `pnpm install`:

```bash
pnpm exec lefthook install
```

Recommended flow:

```bash
pnpm commit
```

## Project layout

- `src/` — TypeScript extension implementation
- `tests/` — behavior-focused tests
- `docs/` — small docs set for contract and architecture
- `docs/media/` — repository-only README media assets

## Documentation

Docs stay intentionally small:

- `docs/README.md` — index
- `docs/contract.md` — external behavior
- `docs/architecture.md` — module boundaries and invariants
