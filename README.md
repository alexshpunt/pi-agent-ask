# pi-agent-ask

Structured user questions for Pi agents. The agent calls `ask_user`, the user answers in a terminal form, and the agent receives structured answers instead of guessing.

## Install

The new npm name is `pi-agent-ask`. It has not been published under that name yet. Install from GitHub for now:

```bash
pi install git:github.com/alexshpunt/pi-agent-ask
```

Remove another pi-ask installation before loading this package so only one extension registers `ask_user`. Reload or restart Pi after changing packages.

For local development:

```bash
pi -e ./src/index.ts
```

## Questions and answers

- One or several questions, with tabs to move between them.
- Single-select, multi-select, and preview questions.
- Preview text inline or loaded from a local UTF-8 file.
- Free-text answers, including alongside selected options in multi-select questions.
- Notes on a question or an option, with `Elaborate` to request clarification before deciding.
- A Review tab to submit, request clarification, or cancel.
- Recommendation markers without automatic selection.
- Native `@` file path autocomplete in answer and note editors.

The tool returns question IDs, selected values, labels, custom text, and notes. Cancellation and clarification are not approval. Questions can be skipped; `required` is advisory.

## Ask while working

Call `ask_user` with `background: true` to queue a form and keep doing independent work. Forms open one at a time. Completed answers reach the agent between turns and can wake an idle agent.

Call `wait_for_answers` when no independent work remains. A queue receipt or empty wait result is not an answer. Work that depends on an answer must wait for it.

## Session history and recovery

- `list_ask_history` searches question records on the active session branch.
- `read_ask_history` reads a saved question, options, answer, notes, and outcome.
- `export_ask_history` writes all or selected records to a new Markdown file.

The journal survives compaction, reload, and resume. It does not record ordinary chat or automatically reuse old answers. Unfinished tool forms can recover when a session starts, resumes, or forks; background queues also survive reload.

## Settings and integrations

Open `/ask-settings`, or press `?` inside a form. Settings include auto-submit, guarded cancellation, review shortcuts, notifications, footer hints, and default multi-select presentation. Keymaps are configurable. Press `t` by default to change the active question's selection type.

The config file is `~/.pi/agent/extensions/pi-agent-ask.json`. Old pi-ask config files are not read, migrated, or deleted. To keep chosen settings, copy the relevant behaviour, keymap, and notification fields manually. See [configuration](docs/configuration.md).

Herdr receives waiting/finished status without question or answer data. Trusted extensions can use local `pi-agent-ask:*` events to receive forms or submit explicit answers. A connected bridge can supply an external UI for foreground calls outside TUI mode; this package does not include a browser UI. Old `@eko24ive/pi-ask:*` event listeners must be updated. See [the integration contract](docs/remote-events.md).

## How this fork differs

This project grew from [eko24ive/pi-ask](https://github.com/eko24ive/pi-ask), based on upstream 1.2.0. It keeps the original question UI but focuses on agent-issued forms.

Compared with that base, this fork adds background question queues and waiting, branch-local question history and export, connected external UI support, structured Codemode results, and Herdr waiting status.

It removes `/answer`, `/answer:again`, and `/ask:replay`. There is no model-based extraction of questions from chat and no manual form replay. Agents should call `ask_user` directly. Normal questions do not make an extra model call.

The bundled [ask-user skill](skills/ask-user/SKILL.md) guides the agent to ask before uncertain or consequential decisions. It is guidance, not an enforcement layer.

## Development

Use pnpm 10, matching CI:

```bash
pnpm install
pnpm format
pnpm typecheck
pnpm test
pnpm test:integration
```

Integration tests require Pi on PATH and the test harness's native `node-pty` build. `pnpm dev [path]` starts an isolated Pi session with this extension and its skill.

See [the tool contract](docs/contract.md), [architecture](docs/architecture.md), and [contributing](CONTRIBUTING.md).

## Credits

The original question flow comes from [eko24ive/pi-ask](https://github.com/eko24ive/pi-ask). Herdr support includes work from [maudelv's branch](https://github.com/maudelv/pi-ask/tree/feat/herdr-blocked-state), with original commit authors preserved. The bundled skill was inspired by [edlsh/pi-ask-user](https://github.com/edlsh/pi-ask-user).

MIT license. See [LICENSE](LICENSE).
