# Ask tool contract

`ask_user` is a pi-native tool that shows the user a form of structured questions and returns their answers.

The package adds no system-prompt rules, configuration paragraph, or skill. Each tool presents itself through a one-line index entry, a description of when to use it, and its input schema fields. `ask_user` applies when the agent needs something only the user can provide: information it could not find, an opinion or preference, or a choice between options. `wait_for_answers` applies when no other work is left and pending background answers are needed. Situational guidance appears in tool results: queued receipts, deferred waits, and validation errors. How often to ask and how to run an interview are left to the user's instructions.

## Input

```ts
{
  title?: string;
  background?: boolean;
  questions: Array<{
    id: string;
    label?: string;
    prompt: string;
    context?: string;
    type?: "single" | "multi";
    options: Array<{
      value: string;
      label: string;
      description?: string;
      recommended?: boolean;
    }>;
  }>;
}
```

## Input rules

- at least one question is required
- every question must have non-empty trimmed `id` and `prompt`
- every question must have at least one option
- question ids must be unique within one tool call
- option `value`s must be unique within a question
- blank optional `title`, question `label`, question `context`, and option `description` fields are treated as omitted
- question `label` falls back to `Q1`, `Q2`, ...
- option `label` is required in the public schema; before schema validation, a missing or blank string label is derived from a non-empty `value` by replacing hyphens and underscores with spaces and capitalizing the first character
- `recommended` is optional presentation metadata; zero, one, or multiple options may set it to `true`
- recommended options render warning-colored `(recommended)` followed by muted ` | <description>`, or only `(recommended)` when no description exists, but are not preselected
- `type` defaults to `single`
- `context` is shown beside the options, or below them on narrow screens, where it is hidden while the custom answer is selected; it is the same for every option; saved option notes and custom text stay visible under their rows, whether or not the option is focused or selected
- a single-line absolute path in `context` is read as a regular, non-empty UTF-8 text file and shown instead of the path; any other value is shown as text
- file read, decoding, binary-data, and empty-file errors return structured `invalid_input` issues at the question's `context` field before UI opens or the payload is saved
- valid tool calls save the loaded file text as `context`, so recovery uses the original snapshot rather than reading the file again
- calls and saved forms from older versions are converted before validation: `type: "preview"` becomes `single`, option `preview` text (and absolute `previewFile` paths) become the question `context`, and the option fields are dropped
- all questions get an internal `Type your own` option

## Output

```ts
{
  content: [{ type: "text"; text: string }];
  details: {
    title?: string;
    cancelled: boolean;
    error?: {
      kind: "invalid_input";
      issues: Array<{
        path: string;
        message: string;
      }>;
    };
    questions: Array<{
      id: string;
      label: string;
      prompt: string;
      type: "single" | "multi";
      presentedType?: "single" | "multi";
    }>;
    skippedQuestionIds?: string[];
    answers: Record<
      string,
      {
        values: string[];
        labels: string[];
        indices: number[];
        customText?: string;
        note?: string;
        optionNotes?: Record<string, string>;
      }
    >;
  };
  structuredContent: {
    requestId?: string;
    cancelled: boolean;
    answers: Record<
      string,
      {
        values: string[];
        labels: string[];
        customText?: string;
        note?: string;
        optionNotes?: Record<string, string>;
        images?: Array<{ mimeType: string; data: string }>;
      }
    >;
    skippedQuestionIds?: string[];
    error?: { issues: Array<{ path: string; message: string }> };
  };
}
```

The tool declares `outputSchema` for `structuredContent` only: the compact
answers above, or the queued receipt for background calls. Codemode receives that
object directly, not `content` text and not `details`. `details` keeps the full
result for rendering, history, and background answers. Normal calls keep the text
summary and TUI rendering. Submitted, cancelled, invalid-input, and non-TUI
results all use these structures. Pi schema-validation failures before execution
remain standard tool errors.

## Output rules

- `cancelled: true` means the user dismissed the flow, UI was unavailable, or the payload was invalid before UI opened
- semantically invalid payloads that reach tool execution return `error.kind === "invalid_input"` with structured `issues` and a transcript-friendly `Invalid ask_user payload:` message; their rendered status is `Invalid tool payload`
- payloads missing schema-required fields fail Pi's schema validation before tool execution and use Pi's standard tool-error result without structured `details`
- unanswered questions without notes are omitted from `answers`; note-only entries remain in `answers` to carry their notes, but all non-cancelled submitted result text includes `<label>: (no answer)` in summary mode and `? <label>: (no answer)` in transcript rendering
- `skippedQuestionIds` lists explicitly skipped questions in original order; their questions remain in result metadata, but their answers, notes, and images are omitted. Skipping is not approval.
- single-select answers still use arrays
- recommendation markers never change canonical submitted labels or values
- when `behaviour.presentSingleAsMulti` is enabled, requested single-select questions are presented and handled as multi-select in future/recovered ask flows; result question metadata keeps the requested `type`, adds `presentedType` when final presentation differs, and result text uses one compact note when any answered questions were presented differently
- `indices` are 1-based rendered option positions
- `customText` stores the free-form answer
- on single-select questions, saving free-form text clears selected options for that question
- on multi-select questions, `values` and `labels` include both selected options and `customText` when both are present
- on multi-select questions, selected options keep their original order and `customText` is appended last
- submitting free-form text on a multi-select question stays on the same question tab and marks the custom row selected
- on multi-select questions, toggling an empty custom row opens the free-form editor, while toggling a custom row with saved free-form text selects or deselects it without opening the editor or clearing the text
- saving or clearing free-form text on a multi-select question does not clear other selected options
- `note` stores a question-level note
- `optionNotes` includes notes for every option, selected or not; result text marks notes on unselected options as `<value> (not selected)`
- question notes may exist without a selected answer
- structured `images` collect the custom-answer, question-note, and option-note images of that answer; text and image content blocks keep their exact association

## Clipboard images

The custom-answer, question-note, and option-note editors accept images through Pi's configured `app.clipboard.pasteImage` shortcut. The form displays the active shortcut. Text paste stays with the native editor. `Ctrl+Alt+D` removes the last image in the current editor; configured Ask commands take precedence over these image actions.

- Text is optional; an image-only custom answer counts as answered.
- Multiple images stay with their editor when saving, reopening, or changing tabs.
- Editors, Review, and answer summaries show attachment markers, not graphical previews or base64 bytes.
- Empty or unavailable image clipboards show a notice without clearing text or images.
- An image read that finishes after its editor closes or the form is disposed cannot attach to another editor.
- Submission includes images on notes for every option, selected or not.
- Deselected custom images stay in the draft but are not submitted. Cancellation strips image data from the returned answer and sends no image blocks.

Answers in `details` add optional `customImages`, `noteImages`, and `optionNoteImages` (option value to image array). Each image is `{ id: string, mimeType: string, data: string }`, where `data` is base64 bytes without a data URI prefix. Image-only custom answers need no synthetic `values`, `labels`, or `customText`.

Normal tool results, background messages, direct waits, recovered answer delivery, and history reads carry real image content blocks with text identifying the question and answer/note. Codemode receives each answer's images in `structuredContent`; forward one with `image({ type: "image", data: attachment.data, mimeType: attachment.mimeType })` when the model should see its pixels. Printing the object is not image delivery.

Submitted image data is stored in the session journal and survives reload and resume. History exports embed image data URIs in the Markdown file, with the owning answer/note identified; viewers without data-URI support still keep the bytes in that file.

Only clipboard input in the TUI is supported. Linux uses a native clipboard or `wl-paste`/`xclip`; WSL can fall back to Windows clipboard access through PowerShell. This adds no file picker, path input, graphical preview, or remote-client image-upload protocol.

## Background-only mode

The opt-in background-only mode removes `background` from the `ask_user` input schema and forces queue execution, even for a stale call containing `background: false`. `wait_for_answers` is hidden and cannot be reactivated or executed. Receipts keep their existing structure; validation errors and non-TUI cancelled results keep theirs. Answers arrive asynchronously as background-answer messages.

The global setting is inherited unless a trusted project explicitly overrides it. Untrusted project config is ignored. `/ask-mode` changes the mode; after the first model request in the current running session, changes to the effective tool interface require cache-impact confirmation before saving or applying. Rejection leaves both unchanged. Switching preserves queued questions and answers. Enabling this mode interrupts an already-running explicit wait without cancelling its forms. See [configuration](configuration.md#question-mode).

## Background queue

`ask_user` accepts optional `background: true`. In TUI mode it validates and persists the form, then returns a receipt instead of waiting:

```ts
{ status: "queued", requestId: string, questionIds: string[], pendingRequests: number }
```

A receipt is not an answer or approval. By default the queue shows one questionnaire at a time, in FIFO order, above the ordinary editor. Each newly shown visible form takes keyboard focus, including the next queued form and recovered forms. The ordinary editor's draft stays intact. Agent work continues; the panel does not hide the working indicator or hold the foreground input lock.

`Alt+Q` switches focus between the panel and ordinary input. `Esc` in the panel or `/ask-defer` defers all questions, preserving the queue and drafts. `/ask-queue` reopens and focuses the pending questionnaire. New requests do not reopen a deliberately hidden panel. `D` in question navigation skips only the current question, removing its answer and notes; in answer/note editors it is ordinary text. Review and completed results mark skipped questions explicitly, including when all questions were skipped. Skipping every question still requires explicit completion.

Each completed form is saved before delivery. Its saved completion renders the answer card, linked by `parentToolCallId` to the original visible execution. Nested calls retain their real outer execution root; missing ownership stays unlinked rather than being guessed. During work the complete answer enters context at the next turn boundary as a hidden `ask:background-answer` custom message with `{ requestId, parentToolCallId?, result?: AskResult, error?: string }` in details. While idle, answers start a new agent turn; cancellation only adds context and never wakes the agent. Cancellation is a terminal form result, not approval.

An idle wake keeps its delivery claim until the answer is recorded in the transcript. Pi starts that turn before recording its opening message; later turn boundaries must not deliver the same answer again.

Background answer text includes the form title when present, its request ID, and every question's ID and full prompt. Answer summaries identify questions by ID as well as label, so repeated labels are unambiguous even without the original call in context. Direct wait results use the same text format. In the TUI, accepted asynchronous answers use the questionnaire's Review style: accent lines, a status and form title, question prompts, arrow-prefixed answers, and saved notes. They have no tabs, buttons, or keyboard hints. Internal message types and request/question IDs are not shown. Normal foreground ask tool results are unchanged. Explicit Wait shows only a brief consumption confirmation; full answer cards stay at the initiating calls in Activity, including their searchable late text, without a second full card in Conversation or Wait. Cancellation and errors have distinct statuses.

`wait_for_answers({})` is a direct, model-only tool. It waits for all outstanding background forms, including forms added while waiting, without a built-in timeout. It returns:

```ts
{ status: "complete", requestIds: string[], results: Array<{ requestId: string, parentToolCallId?: string, result?: AskResult, error?: string }> }
```

Hiding the question panel or sending ordinary input during a wait releases only that wait:

```ts
{ status: "deferred", reason: "hidden" | "user_message", requestIds: string[], pendingRequestIds: string[], results: Array<{ requestId: string, parentToolCallId?: string, result?: AskResult, error?: string }> }
```

The questions and drafts remain pending. `results` includes only completed outcomes not already delivered; `pendingRequestIds` identifies unanswered requests. Sending a message also hides the panel and lets the agent process that message. A deferred wait is not an answer, cancellation, or approval; its result tells the agent not to repeat the wait automatically.

Results already delivered asynchronously are not repeated. Forms completed during the wait return through its result, not duplicate messages. An empty queue returns immediately. Aborting the wait leaves the forms queued. Explicit cancellation finishes only that background questionnaire and does not abort unrelated agent work. UI failures are reported with an error, never invented answers.

Queue state is rebuilt from the active branch on startup, reload, resume, fork, and tree navigation. Completed forms do not reopen; actual answer messages and successful direct wait results mark delivery. Completed but undelivered results are recovered. Old surfaces cannot write answers into a different branch after a session change. In non-TUI modes background calls keep the normal cancelled fallback and do not enqueue; waiting is unavailable.

Recovered panels wait for the native editor without replacing it. Drafts, skipped questions, and panel visibility follow the active branch across reload and resume. Other input dialogs retain their own input surface.

A visible background question panel holds a `herdr:blocked` indication. Hiding or deferring the panel releases this indication while preserving queued questions; reopening the panel restores it. Completion, cancellation, errors, disposal, and session changes release the panel's ownership. An active `wait_for_answers` holds its own waiting status until it completes, is deferred, is aborted, or is disposed. Other active waits keep Herdr blocked when the panel is hidden or finishes.

## Session question history

Every valid `ask_user` tool call gets an extension-generated UUID `requestId`. Foreground results include it in `details`, `structuredContent`, and agent-facing text. Background receipts and completion wrappers use the same key. An individual question is addressed by `{ requestId, questionId }`, where `questionId` is its existing `id`. Repeated question IDs or Pi tool-call IDs do not overwrite requests.

Normalized questions and loaded contexts are saved before waiting for input. Outcomes are saved before answer delivery, even for nested calls that do not have a separate tool-result entry. The journal is stored only in the session file, outside normal model context. It survives compaction, reload, and resume without relying on summaries. Reads follow `getBranch()` including its ancestors; sibling branches and other sessions are not available.

The three history tools are disabled by default. Enable them with the global `behaviour.historyTools` setting and reload Pi. Recording does not depend on this setting. When enabled, the tools have empty native TUI call/result rows, including errors and resumed history. This does not hide data from the session file or prevent the agent from quoting it.

### Tools

- `list_ask_history({ query?, answeredOnly?, offset?, limit? })` returns `{ total, offset, nextOffset?, records }`. Search is case-insensitive across recorded data. The default limit is 50, maximum 200. Each summary includes both keys, prompt, label, title when set, creation time, background flag, status, and `hasAnswer`. Follow `nextOffset` until absent to reach the full filtered list.
- `read_ask_history({ requestId, questionId })` returns `{ record }`: the full normalized question, its saved context and options, answer values/labels/positions, custom text, notes, and outcome. Missing or out-of-branch keys are tool errors.
- `export_ask_history({ path, keys? })` returns `{ path, keys }`. Omit `keys` for the full current-branch journal; otherwise supply a non-empty array of question keys. Duplicate selections are deduplicated, and records keep journal order. All keys are validated before any file is created. A missing or out-of-branch key fails the whole selection.

Statuses are `waiting`, `answered`, `skipped`, `cancelled`, and `error`. Notes without a committed answer remain available but are not answers. `answeredOnly` and `hasAnswer` identify committed answers. A cancellation or waiting result is not approval.

Export writes a new UTF-8 Markdown file relative to Pi's working directory or to an absolute path. The parent directory must exist. It never replaces an existing file or follows a destination symlink. Text fields use literal fenced blocks so Markdown punctuation and line breaks stay intact; no model rewriting is involved. Exported records include identity, request context, options, answers, notes, and status. Write failures are tool errors, not successful exports.

Ordinary and background tool calls, including a connected external UI's foreground result, are captured. Recovering an interrupted tool request completes its original journal key when present. Ordinary chat does not create journal requests. Existing sessions without journal entries are not reconstructed. The journal does not automatically reuse answers, create tasks, or write files except through explicit export calls.

## Product identity

The npm package and product name are `pi-agent-ask`. Settings use `extensions/pi-agent-ask.json` under Pi's agent directory; upstream settings files are not read or changed. Local integration events use `pi-agent-ask:*` without old-name aliases. The only slash command is `/ask-settings`; agents ask through `ask_user`, not chat extraction or manual replay.

## Supported UX

- tabbed multi-question flow
- single-select and multi-select questions, each with optional context
- optional warning-colored recommendation subtitles in option lists without automatic selection
- active question type changes via configurable `main.changeQuestionType` hotkey, default `t`, toggling `single <-> multi`
- inline free-form answers for all question types
- native pi-style `@` file path autocomplete inside free-form answer and note editors
- question notes via `Shift+N`
- option notes via `n`
- number-key quick selection
- submit/cancel review tab
- the review tab shows every question note and every option note, including notes on unselected options
- transcript-friendly call and result rendering
- automatic recovery of the newest unresolved `ask_user` form on startup, resume, or fork
- ask settings list with binary behaviour/notification toggles and a guarded reset-to-defaults action
- `?` in the ask flow and `/ask-settings` in pi open the same lightweight ask settings overlay
- settings attempt to persist immediately when changed: `Auto-submit when answered without notes`, `Confirm dismiss when dirty`, `Double-press review shortcuts`, `Notifications`, and `Show footer hints`; `Present single-select as multi-select` persists immediately when saving succeeds but applies only to new/recovered ask flows; save failures revert the setting and show a manual-edit message; resetting config to defaults requires pressing the reset action twice within a short confirmation window
- `Keymaps` is a persisted, context-aware config section for global, main-flow, editor, note-editor, and settings-modal actions
- the settings list shows the absolute config file path for customizing keymaps and notifications
- if the flow is already on the review tab, all questions are answered, and no notes exist, enabling auto-submit can complete the current ask flow immediately

## Mouse behavior

Fullscreen forms accept clicks on visible options, question tabs, Review, and review actions. An option click uses the same selection behavior as its number shortcut, including multi-select toggles and custom-answer editing. Review actions keep the configured double-press safeguard. Pressing, dragging, or releasing alone never submits an answer.

The whole visible background panel is a keyboard-focus area. When focus is outside the panel, the first click anywhere inside it only restores focus. This includes options, tabs, Review actions, headings, prompts, blank space, borders, and the scroll footer. That click does not select an answer, navigate, submit, or count toward a double-press safeguard. Subsequent clicks perform their normal actions while the panel is focused. Newly shown visible forms take focus automatically, so their first click can act immediately. No prior `Alt+Q` is needed, and ordinary input drafts stay intact. Clicking the ordinary editor releases panel focus without closing or answering the questionnaire; closing a settings overlay still restores the previous form focus. Wheel scrolling and resized layouts use the visible rows, not stale screen positions. Context and review text beside an action is not part of its click target. Regular terminal mode leaves mouse input to terminal selection and keeps keyboard controls.

## Keyboard behavior

Main flow:

- `global.settings` opens ask settings; default: `?`
- `global.dismiss` dismisses the active ask surface; default: `Ctrl+C`
- `main.nextTab` / `main.previousTab` move between tabs; defaults: `Tab`/`Right`, `Shift+Tab`/`Left`
- `main.nextOption` / `main.previousOption` move between options or review actions; defaults: `Down`, `Up`
- `main.confirm`, `main.cancel`, and `main.toggle` confirm, cancel, or toggle; defaults: `Enter`, `Esc`, `Space`
- on multi-select questions, `Space` toggles the highlighted choice without advancing; `Enter` keeps all choices and advances to the next question or Review, even when a saved custom answer is highlighted
- submitting custom-answer text with `Enter` also advances; closing that editor with `Esc` saves without advancing
- cancelling or dismissing a foreground form stops the current agent operation; cancelling a background form closes only that form, in either question mode; dirty-dismiss confirmation still applies; closing an editor or settings does not stop the agent
- a background cancellation is recorded and can be delivered as context, but never starts a new agent turn by itself
- `main.changeQuestionType` changes the active question type (`single <-> multi`); default: `t`; destructive `multi -> single` changes require pressing the type hotkey again, with no timeout, and the pending confirmation clears on other navigation/actions
- `main.optionNote` and `main.questionNote` open option/question notes; defaults: `n`, `Shift+N`
- `1..9` is fixed and selects or toggles the matching option; on the review tab, `1` and `2` trigger `Submit` and `Cancel`
- when `Double-press review shortcuts` is enabled, review-tab `1` and `2` require the same key twice without a timeout, and the review screen shows an inline hint for the pending action

Editing flow:

- `editor.submit` submits the current custom-answer editor input and closes the editor; default: `Enter`
- `noteEditor.save` saves the current note editor and keeps the ask flow open; default: `Enter`
- `editor.close` / `noteEditor.close` save draft and close the editor; default: `Esc`
- `global.dismiss` dismisses the entire flow immediately without saving the current editor draft when no dirty-dismiss confirmation is pending
- `global.settings` opens ask settings when the editor is empty; otherwise the key is delegated to the editor as text/input
- when editor has text, arrow keys and `Tab` stay in the editor so the cursor can move while typing
- when editor is empty, editor-context `*WhenEmpty` navigation actions move options or tabs without requiring the editor close binding first
- `@` remains a fixed file-reference affordance in editors

Settings modal:

- `settingsModal.close` closes settings; defaults: `Esc`, `Ctrl+C`, `?`
- `settingsModal.nextOption` / `settingsModal.previousOption` move between settings; defaults: `Down`, `Up`
- `settingsModal.toggle` toggles the highlighted setting and attempts to save immediately; if saving fails, the setting reverts and an error is shown; on the reset action, the same binding must be pressed twice within a short confirmation window; defaults: `Enter`, `Space`

Dirty dismiss:

- when `Confirm dismiss when dirty` is enabled, cancelling or dismissing a dirty ask flow requires the same action a second time
- the dirty-dismiss warning stays visible until the user changes tabs in the ask flow

## Non-TUI and non-interactive modes

The rich ask flow uses `ctx.ui.custom()` and opens only in TUI mode. A non-TUI foreground `ask_user` can instead wait for an explicitly connected external UI supplied by a trusted extension in the same Pi process. The bridge must check that its UI is connected and supported before offering it; environment variables alone are not a connection.

Without a supported connection, print, JSON, RPC, and other non-TUI calls keep the `Needs user input: ask_user requires interactive TUI mode.` message and cancelled result. Non-TUI background calls always keep that fallback and never open the external UI.

Connected foreground calls stay pending until an explicit answer or cancel. pi-agent-ask loads file contexts, applies `presentSingleAsMulti`, validates question ids and values, and builds the normal result with locally computed labels and indices. Cancel stops the current agent operation, as in TUI. Operation abort closes the external form; late responses cannot change the result. UI disconnection, rejection, or a malformed returned response is a tool error, not an invented answer or user cancellation. All terminal paths remove the active flow and abort the provider's signal.

The native TUI remains the default and never negotiates an external surface. This contract does not transport TUI components, settings, or background queues. The external UI owns its layout and transport; pixel parity and universal extension support are not promised. See [external UI negotiation](remote-events.md#external-ui-negotiation) for the adapter API.

The public tool schema requires question `id` and `prompt` plus option `value` and `label`, and it restricts question `type` to `single` or `multi`, so malformed structural fields fail before execution. The tool still validates trimmed text, uniqueness, option counts, and context files during execution and returns structured issues for those failures. Result rendering falls back to Pi's raw tool-error text when schema validation prevents execution.

The ask flow subscribes to runtime settings updates while open. In practice, this means changing `Auto-submit when answered without notes`, `Confirm dismiss when dirty`, `Double-press review shortcuts`, `Notifications`, `Show footer hints`, resetting config to defaults, or reloading config-backed keymaps can affect the in-progress ask flow immediately instead of only future asks when the change is saved or otherwise applied in memory. Load-time migrations and invalid config handling do not rewrite, rename, or back up the config file; invalid files load defaults for the session and show a notice. `Present single-select as multi-select` is applied when an ask flow is created and does not rewrite question semantics for an already-open flow; use `main.changeQuestionType` for live per-question changes.

## Notifications

When enabled, pi-agent-ask emits one best-effort external notification per ask session after the ask UI opens and waits for input. The default title is `pi-agent-ask`; the message is `Question waiting: <label or prompt>`. Channels run in configured order and failures never fail or cancel the ask flow.

## Herdr blocked lifecycle

For foreground interactive TUI ask flows, the extension optionally emits on `pi.events`:

- `herdr:blocked` with `{ active: true, label: "Waiting for user response" }`
  immediately before waiting for input;
- `herdr:blocked` with `{ active: false }` when the last active wait ends.

Successful answers, cancellation, abort/timeout, and UI errors release the flow's waiting status. A separate foreground flow or explicit answer wait keeps Herdr blocked until it also ends. This signal is status-only: it does not include questions, context,
answers, notes, or remote submission data. Non-interactive execution does not emit
this lifecycle.

## Remote inter-extension events

pi-agent-ask exposes a local `pi.events` contract for trusted Pi extensions. It does not expose a network API and does not automate terminal keystrokes. RPC or headless integrations should use a trusted in-process bridge extension that consumes these events rather than expecting the TUI-only custom surface to open.

Channels:

- `pi-agent-ask:started`
- `pi-agent-ask:completed`
- `pi-agent-ask:submit`
- `pi-agent-ask:submit-result`

Remote submissions must be explicit `{ kind: "answer" }` or `{ kind: "cancel" }` responses. Remote answers use question ids and normalized option values from the started event. pi-agent-ask validates ids and values, recomputes labels/indices, and does not infer approval semantics from labels.

See [`remote-events.md`](remote-events.md) for payload shapes, examples, and a local smoke test.

## Interrupted ask resume

- on `session_start` with reason `startup`, `resume`, or `fork`, pi-agent-ask finds the newest `ask_user` tool call on the active branch that has neither a tool result nor an `ask:pending-dismissed` entry
- recovery does not run for `new`, `reload`, or non-TUI sessions
- the matching valid `ask:payload` supplies the form; if it is missing or invalid, pi-agent-ask validates and uses the original tool call arguments instead
- the recovery flow is detached from `session_start`, so an open form does not block other lifecycle handlers
- because the interrupted `execute` promise no longer exists, submit sends the result as a user follow-up message
- submit and cancel append `ask:pending-dismissed`, preventing another automatic reopen
- recovered flows emit remote lifecycle events with source `ask:resume`

The fallback message includes normalized pending questions and options so the caller can re-ask them manually. `details.questions` still contains normalized question metadata, while `details.answers` stays empty until a user responds.

## Source of truth

Behavior should be verified against:

1. `src/types.ts` and exported state/result helpers
2. `tests/*.test.ts`
3. this contract
