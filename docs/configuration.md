# pi-agent-ask configuration

This is the configuration guide for `pi-agent-ask`. Edit the config file, validate keymaps, then run `/reload` or restart Pi.

## Config file

`~/.pi/agent/extensions/pi-agent-ask.json`

The extension attempts to create this file with defaults when it initializes the question mode. A read-only location uses in-memory defaults and shows a notice. Loading an existing file never rewrites or backs it up. Invalid files stay unchanged and load defaults for the session.

Old `eko24ive-pi-ask.json` files are not loaded, moved, or deleted. There is no automatic migration from the old product name. Copy any wanted behaviour, keymap, and notification settings manually into the new file. The old `answer` extraction settings have no use in this package.

Supported older schema versions migrate in memory. Keep `schemaVersion` at `5` when editing the current config.

## Default config

```json
{
  "schemaVersion": 5,
  "behaviour": {
    "backgroundOnly": false,
    "historyTools": false,
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

## Behaviour

- `autoSubmitWhenAnsweredWithoutNotes`: auto-submit from Review when all questions have answers and no notes. Default `false`.
- `confirmDismissWhenDirty`: require the same cancel/dismiss action twice when answers, notes, or editor drafts exist. The warning stays until the user changes tabs. Default `true`.
- `doublePressReviewShortcuts`: require the same Review number shortcut twice. There is no timeout; changing the shortcut or leaving Review clears it. Default `true`.
- `presentSingleAsMulti`: present requested single-select questions as multi-select in new or restored flows. Results keep the requested type and report the changed presentation. This does not change an already-open form. Default `false`.
- `showFooterHints`: show keyboard hints. Default `true`.

Open `/ask-settings` or press `?` inside a form to toggle behaviour or notification enablement. Changes save immediately when possible; save failures revert the setting and show the path for manual editing. Reset-to-defaults requires a quick second press. Use it only when the user asks to reset.

Saved runtime changes affect an open form, except `presentSingleAsMulti`, which applies when a form is created. For a live question-type change, use `main.changeQuestionType` (`t` by default). It toggles `single <-> multi`, or `preview <-> multi`. A multi-to-single change that would discard multiple choices requires another press, without a timeout.

## Question mode

Normal mode is the default. Run `/ask-mode` to choose a scope and mode, or use:

```text
/ask-mode global background-only
/ask-mode global normal
/ask-mode project background-only
/ask-mode project normal
/ask-mode project inherit
```

Background-only mode removes the `background` parameter from `ask_user` and makes every valid call queue a form. It also hides and disables `wait_for_answers`. The agent continues independent work, then ends its turn; an answer wakes it asynchronously. A queued receipt is not an answer or approval. Without a TUI queue, calls keep the cancelled non-interactive result and never open a synchronous external form.

The global file stores `behaviour.backgroundOnly` (default `false`). A trusted project's `.pi/extensions/pi-agent-ask.json` can override just this setting:

```json
{
  "behaviour": { "backgroundOnly": true }
}
```

A project value of `false` overrides a global `true`. Omit the field, or use `project inherit`, to inherit the global value. Untrusted project config is ignored; the command refuses to save a project override until Pi trusts the project. Other project-local ask settings are not loaded.

Before the first model request in the current running session, a mode change needs no cache warning. After that request, any change to the effective mode asks for confirmation: changing tool definitions can invalidate prompt-cache reuse. Declining keeps both the saved setting and the tool interface unchanged. Updating a global default hidden by a project override does not change tools or require this confirmation. Mode changes preserve queued forms and answers; enabling background-only also interrupts an existing explicit wait without cancelling its questions.

`/ask-settings` and its reset action manage form settings, not the question mode. Use `/ask-mode` to change the mode. Manual config edits take effect after reload or restart.

## History tools

Set `behaviour.historyTools` to `true` in the global config file, then run `/reload` or restart Pi to expose `list_ask_history`, `read_ask_history`, and `export_ask_history`. The default is `false`. Set it back to `false` and reload to remove these tools.

Question and answer recording stays enabled in either case. This setting has no project override and is not a live `/ask-settings` toggle.
## Keymaps

Each action accepts a pi-tui key string or an array of aliases. Contexts:

- `global`: dismissal and settings in the main flow and editors.
- `main`: questions and Review.
- `editor`: custom answers.
- `noteEditor`: question and option notes.
- `settingsModal`: the settings list.

Use supported pi-tui key IDs. Common aliases normalize: `escape` to `esc`, `return` to `enter`, `control+c` to `ctrl+c`, `Shift+N` to `shift+n`, and `pageup` to `pageUp`.

Bindings must be unique within each context. Global bindings must not overlap with main, editor, or note-editor bindings. Keep all required contexts and actions. Numeric shortcuts `1..9` are fixed and cannot be configured. `@` remains the file-reference affordance.

In a non-empty editor, arrows and Tab move the cursor rather than changing questions. Empty editors use the `*WhenEmpty` actions for navigation.

For multi-select questions, `Space` toggles the highlighted choice. `Enter` keeps the choices and moves to the next question or Review, including when a saved custom answer is highlighted. In the custom-answer editor, `Enter` saves the text and advances; `Esc` saves it without advancing.

Invalid keymaps fall back to defaults for the session with a notice. Other valid settings still load. The settings list shows the full config path; edit that file to change keymaps or notification channels.

## Background queue controls

Background questions appear above the ordinary editor without changing its focus. These queue controls are fixed and separate from the form keymaps:

- `Alt+Q`: switch between the question panel and normal input; reopen the panel if hidden.
- `Esc` in the panel: defer all questions, keeping the queue and drafts.
- `/ask-defer`: defer all questions from ordinary input.
- `/ask-queue`: reopen and focus the pending questionnaire.
- `D` in question navigation: skip only the current question. In answer/note editors it remains ordinary text.
- `PageUp` / `PageDown` in the panel: scroll a tall questionnaire. Navigation brings the active option or answer editor back into view.

In fullscreen mode, click anywhere inside the question panel to give it keyboard focus, including its heading, prompt, blank space, borders, or scroll footer. Clicking an option also selects it or toggles a multi-select choice. Click a question tab or Review to switch tabs, and use the wheel over the panel to scroll. Clicking a choice focuses the panel without changing the ordinary editor's draft. Click the ordinary editor to return to writing a message while the form stays open. Review actions require two clicks when `Double-press review shortcuts` is enabled. In regular terminal mode, use the keyboard; the terminal keeps mouse selection.

Hiding the panel or sending a normal message during `wait_for_answers` releases that wait, not the pending questions. New requests do not reopen a deliberately hidden panel. Foreground forms keep their configured cancellation behavior.

## Notifications

Notifications run once when an ask form opens and waits for input. They are best-effort: channel failure never fails or cancels a form.

`notifications.enabled` defaults to `true`. `notifications.channels` defaults to `["bell"]`. Channels run in order:

- `"bell"`: terminal BEL.
- `"osc9"`: OSC 9 notification.
- `"osc777"`: OSC 777 title/body notification.
- `{ "type": "command", "command": "..." }`: shell command.

Invalid channels are skipped. If none are valid, the default bell is used.

Command channels receive:

```sh
ASK_NOTIFY_EVENT=question.waiting
ASK_NOTIFY_TITLE="pi-agent-ask"
ASK_NOTIFY_MESSAGE="Question waiting: <label or prompt>"
```

For cmux:

```json
{
  "type": "command",
  "command": "cmux notify --title \"$ASK_NOTIFY_TITLE\" --body \"$ASK_NOTIFY_MESSAGE\""
}
```

## Editing for a user

Preserve unrelated fields and notification channels. Only change notification enablement unless the user asks to change targets. Avoid duplicate bindings and fixed numeric shortcuts. Keep schema version `5`. After manual editing, ask the user to reload or restart Pi.
