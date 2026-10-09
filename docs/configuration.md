# pi-agent-ask configuration

This is the configuration guide for `pi-agent-ask`. Edit the config file, validate keymaps, then run `/reload` or restart Pi.

## Config file

`~/.pi/agent/extensions/pi-agent-ask.json`

The first ask attempts to create this file with defaults. A read-only location uses in-memory defaults and shows a notice. Loading an existing file never rewrites or backs it up. Invalid files stay unchanged and load defaults for the session.

Old `eko24ive-pi-ask.json` files are not loaded, moved, or deleted. There is no automatic migration from the old product name. Copy any wanted behaviour, keymap, and notification settings manually into the new file. The old `answer` extraction settings have no use in this package.

Supported older schema versions migrate in memory. Keep `schemaVersion` at `5` when editing the current config.

## Default config

```json
{
  "schemaVersion": 5,
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

## Behaviour

- `autoSubmitWhenAnsweredWithoutNotes`: auto-submit from Review when all questions have answers and no notes. Default `false`.
- `confirmDismissWhenDirty`: require the same cancel/dismiss action twice when answers, notes, or editor drafts exist. The warning stays until the user changes tabs. Default `true`.
- `doublePressReviewShortcuts`: require the same Review number shortcut twice. There is no timeout; changing the shortcut or leaving Review clears it. Default `true`.
- `presentSingleAsMulti`: present requested single-select questions as multi-select in new or restored flows. Results keep the requested type and report the changed presentation. This does not change an already-open form. Default `false`.
- `showFooterHints`: show keyboard hints. Default `true`.

Open `/ask-settings` or press `?` inside a form to toggle behaviour or notification enablement. Changes save immediately when possible; save failures revert the setting and show the path for manual editing. Reset-to-defaults requires a quick second press. Use it only when the user asks to reset.

Saved runtime changes affect an open form, except `presentSingleAsMulti`, which applies when a form is created. For a live question-type change, use `main.changeQuestionType` (`t` by default). It toggles `single <-> multi`, or `preview <-> multi`. A multi-to-single change that would discard multiple choices requires another press, without a timeout.

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

Invalid keymaps fall back to defaults for the session with a notice. Other valid settings still load. The settings list shows the full config path; edit that file to change keymaps or notification channels.

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
