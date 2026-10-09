# Ask tool contract

`ask_user` is a pi-native clarification tool for cases where implementation depends on user preference or missing requirements.

This document defines the stable external behavior. It does not explain internal helper-by-helper implementation.

## Input

```ts
{
  title?: string;
  background?: boolean;
  questions: Array<{
    id: string;
    label?: string;
    prompt: string;
    type?: "single" | "multi" | "preview";
    required?: boolean;
    options: Array<{
      value: string;
      label: string;
      description?: string;
      preview?: string;
      previewFile?: string;
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
- blank optional `title`, question `label`, option `description`, and option `preview` fields are treated as omitted
- question `label` falls back to `Q1`, `Q2`, ...
- option `label` is required in the public schema; before schema validation, a missing or blank string label is derived from a non-empty `value` by replacing hyphens and underscores with spaces and capitalizing the first character
- `recommended` is optional presentation metadata; zero, one, or multiple options may set it to `true`
- recommended options render warning-colored `(recommended)` followed by muted ` | <description>`, or only `(recommended)` when no description exists, but are not preselected
- `type` defaults to `single`
- `required` defaults to `false`
- `required` is metadata only; it never blocks submission
- preview questions require preview text or a preview file for every declared option; option descriptions do not satisfy this requirement, and invalid preview payloads report a fix hint to add preview text or switch to `type: "single"`
- options may use `previewFile?: string` instead of `preview`: a regular, non-empty UTF-8 text file, with an absolute path or a path relative to `ctx.cwd`
- non-blank `preview` and `previewFile` on the same option are invalid; blank paths are treated as omitted
- file read, decoding, binary-data, and empty-file errors return structured `invalid_input` issues at the option's `previewFile` field before UI opens or the payload is saved
- the file content uses the existing plain-text preview renderer; labels and answer values do not change
- valid tool calls save the loaded text as `preview` without `previewFile`, so replay and recovery use the original snapshot rather than reading the file again
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
    mode: "submit" | "elaborate";
    questions: Array<{
      id: string;
      label: string;
      prompt: string;
      type: "single" | "multi" | "preview";
      presentedType?: "single" | "multi" | "preview";
    }>;
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
    continuation?: {
      strategy: "refine_only" | "resume";
      affectedQuestionIds: string[];
      preservedAnswers: Record<string, {
        values: string[];
        labels: string[];
        indices: number[];
        customText?: string;
        note?: string;
        optionNotes?: Record<string, string>;
      }>;
      questionStates: Record<string, {
        status: "answered" | "needs_clarification" | "unanswered";
      }>;
    };
    elaboration?: {
      instruction: string;
      nextAction: "clarify" | "clarify_then_reask";
      items: Array<
        | {
            target: { kind: "question" };
            question: {
              id: string;
              label: string;
              prompt: string;
              type: "single" | "multi" | "preview";
              presentedType?: "single" | "multi" | "preview";
              options: Array<{
                value: string;
                label: string;
                description?: string;
                preview?: string;
                recommended?: boolean;
              }>;
            };
            answered: boolean;
            answer?: {
              values: string[];
              labels: string[];
              indices: number[];
              customText?: string;
              note?: string;
              optionNotes?: Record<string, string>;
            };
            note: string;
          }
        | {
            target: { kind: "option"; optionValue: string };
            question: {
              id: string;
              label: string;
              prompt: string;
              type: "single" | "multi" | "preview";
              presentedType?: "single" | "multi" | "preview";
              options: Array<{
                value: string;
                label: string;
                description?: string;
                preview?: string;
                recommended?: boolean;
              }>;
            };
            option: {
              value: string;
              label: string;
              description?: string;
              preview?: string;
              recommended?: boolean;
            };
            selected: boolean;
            answered: boolean;
            answer?: {
              values: string[];
              labels: string[];
              indices: number[];
              customText?: string;
              note?: string;
              optionNotes?: Record<string, string>;
            };
            note: string;
          }
      >;
    };
  };
}
```

The tool declares `outputSchema` and returns the same `AskResult` in both
`details` and `structuredContent`. Codemode receives that object directly, not
`content` text and not a wrapper with `details`. Normal calls keep the text summary
and TUI rendering. Submitted, elaborated, cancelled, invalid-input, and non-TUI
results all use this structure. Pi schema-validation failures before execution
remain standard tool errors.

## Output rules

- `cancelled: true` means the user dismissed the flow, UI was unavailable, or the payload was invalid before UI opened
- semantically invalid payloads that reach tool execution return `error.kind === "invalid_input"` with structured `issues` and a transcript-friendly `Invalid ask_user payload:` message; their rendered status is `Invalid tool payload`
- payloads missing schema-required fields fail Pi's schema validation before tool execution and use Pi's standard tool-error result without structured `details`
- `mode: "submit"` is normal completion; `mode: "elaborate"` means the user asked the agent to continue with follow-up clarification based on notes
- unanswered questions without notes are omitted from `answers`; note-only entries remain in `answers` to carry their notes, but all non-cancelled submitted result text includes `<label>: (no answer)` in summary mode and `? <label>: (no answer)` in transcript rendering
- in `mode: "elaborate"`, `answers` contains only committed answers; note-only entries move to `elaboration.items`
- `continuation.strategy === "refine_only"` means the next ask should refine the current flow rather than restart it
- `continuation.preservedAnswers` contains previously committed answers that should be kept as context and not re-asked
- `continuation.affectedQuestionIds` lists the only questions that should be revisited
- `continuation.questionStates` marks each question as `answered`, `needs_clarification`, or `unanswered`
- single-select answers still use arrays
- recommendation markers never change canonical submitted labels or values
- when `behaviour.presentSingleAsMulti` is enabled, requested single-select questions are presented and handled as multi-select in future/replayed ask flows; result question metadata keeps the requested `type`, adds `presentedType` when final presentation differs, and result text uses one compact note when any answered questions were presented differently
- `indices` are 1-based rendered option positions
- `customText` stores the free-form answer
- on single-select questions, saving free-form text clears selected options for that question
- on multi-select questions, `values` and `labels` include both selected options and `customText` when both are present
- on multi-select questions, selected options keep their original order and `customText` is appended last
- submitting free-form text on a multi-select question stays on the same question tab and marks the custom row selected
- on multi-select questions, toggling an empty custom row opens the free-form editor, while toggling a custom row with saved free-form text selects or deselects it without opening the editor or clearing the text
- saving or clearing free-form text on a multi-select question does not clear other selected options
- `note` stores a question-level note
- `optionNotes` includes only notes for selected options
- question notes may exist without a selected answer
- `elaboration.items` includes all question notes and all option notes, even for unselected options
- every elaboration item includes the full normalized question and option list for that question so referential notes like `above` remain understandable to the agent
- option-targeted elaboration items include the specific noted option plus whether it is currently selected
- question-targeted elaboration items include whether the question already has a committed answer
- `elaboration.instruction` tells the agent to answer the clarification directly first, then re-ask only the affected questions if a choice is still needed
- after clarification, agents should prefer another structured follow-up over plain-text multiple choice when a decision is still unresolved
- once prior answers narrow the branch, agents should bundle the next 2-3 related unresolved questions into one follow-up ask when possible, instead of using a long sequence of single-question asks
- `elaboration` is only present when `mode === "elaborate"`
- elaborate `content` text and transcript rendering describe each note directly using the full question prompt and option label, and include the current committed answer text when available, instead of a generic elaboration banner
- when the user selects `Elaborate` without adding notes, elaborate `content` text and transcript rendering still include the committed answer text so the agent can elaborate on that answer directly

## Background queue

`ask_user` accepts optional `background: true`. In TUI mode it validates and persists the form, then returns a receipt instead of waiting:

```ts
{ status: "queued", requestId: string, questionIds: string[], pendingRequests: number }
```

A receipt is not an answer or approval. The queue automatically opens one form at a time, in FIFO order. Other ask surfaces share the same input lock. Agent work continues while a background form is open; it does not hide the working indicator itself.

Each completed form is saved before delivery. During work it enters context at the next turn boundary as an `ask:background-answer` custom message with `{ requestId, result?: AskResult, error?: string }` in details. While idle, answers start a new agent turn; cancellation only adds context and never wakes the agent. Cancellation and elaboration are terminal form results, not approval.

An idle wake keeps its delivery claim until the answer is recorded in the transcript. Pi starts that turn before recording its opening message; later turn boundaries must not deliver the same answer again.

Background answer text includes the form title when present, its request ID, and every question's ID and full prompt. Answer summaries identify questions by ID as well as label, so repeated labels are unambiguous even without the original call in context. Direct wait results use the same text format. In the TUI, accepted asynchronous answers use the questionnaire's Review style: accent lines, a status and form title, question prompts, arrow-prefixed answers, and saved notes. They have no tabs, buttons, or keyboard hints. Internal message types and request/question IDs are not shown. Normal ask tool results and direct wait rendering are unchanged. Cancellation, clarification, and errors have distinct statuses.

`wait_for_answers({})` is a direct, model-only tool. It waits for all outstanding background forms, including forms added while waiting, without a built-in timeout. It returns:

```ts
{ status: "complete", requestIds: string[], results: Array<{ requestId: string, result?: AskResult, error?: string }> }
```

Results already delivered asynchronously are not repeated. Forms completed during the wait return through the wait result, not duplicate messages. An empty queue returns immediately. Aborting the wait leaves the forms queued; user cancellation closes that form and stops the current agent operation. UI failures are reported with an error, never invented answers.

Queue state is rebuilt from the active branch on startup, reload, resume, fork, and tree navigation. Completed forms do not reopen; actual answer messages and successful direct wait results mark delivery. Completed but undelivered results are recovered. Old surfaces cannot write answers into a different branch after a session change. In non-TUI modes background calls keep the normal cancelled fallback and do not enqueue; waiting is unavailable.

Recovered forms wait until Pi restores the editor after its lifecycle loading screen. They then open in the usual editor slot; the loading screen must not hide a still-pending form. This wait does not use a timer, reopen completed forms, or stop independent agent work.

Open background forms emit `herdr:blocked` while the agent keeps working, with cleanup when the form closes. Aborting an explicit wait does not clear an open form's blocked status. Tool prompt guidelines and the bundled skill explain this workflow and forbid dependent work before answers.

## Session question history

Every valid `ask_user` tool call gets an extension-generated UUID `requestId`. Foreground results include it in `details`, `structuredContent`, and agent-facing text. Background receipts and completion wrappers use the same key. An individual question is addressed by `{ requestId, questionId }`, where `questionId` is its existing `id`. Repeated question IDs or Pi tool-call IDs do not overwrite requests.

Normalized questions and loaded previews are saved before waiting for input. Outcomes are saved before answer delivery, even for nested calls that do not have a separate tool-result entry. The journal is stored only in the session file, outside normal model context. It survives compaction, reload, and resume without relying on summaries. Reads follow `getBranch()` including its ancestors; sibling branches and other sessions are not available.

Three agent-callable tools have empty native TUI call/result rows, including errors and resumed history. This does not hide data from the session file or prevent the agent from quoting it.

### Tools

- `list_ask_history({ query?, answeredOnly?, offset?, limit? })` returns `{ total, offset, nextOffset?, records }`. Search is case-insensitive across recorded data. The default limit is 50, maximum 200. Each summary includes both keys, prompt, label, title when set, creation time, background flag, status, mode when complete, and `hasAnswer`. Follow `nextOffset` until absent to reach the full filtered list.
- `read_ask_history({ requestId, questionId })` returns `{ record }`: the full normalized question and options, saved previews, answer values/labels/positions, custom text, notes, question-specific elaboration, and outcome. Missing or out-of-branch keys are tool errors.
- `export_ask_history({ path, keys? })` returns `{ path, keys }`. Omit `keys` for the full current-branch journal; otherwise supply a non-empty array of question keys. Duplicate selections are deduplicated, and records keep journal order. All keys are validated before any file is created. A missing or out-of-branch key fails the whole selection.

Statuses are `waiting`, `answered`, `skipped`, `cancelled`, `clarification`, and `error`. Notes without a committed answer remain available but are not answers. `answeredOnly` and `hasAnswer` identify committed answers; clarification may still be pending. A cancellation, waiting result, or clarification is not approval.

Export writes a new UTF-8 Markdown file relative to Pi's working directory or to an absolute path. The parent directory must exist. It never replaces an existing file or follows a destination symlink. Text fields use literal fenced blocks so Markdown punctuation and line breaks stay intact; no model rewriting is involved. Exported records include identity, request context, options, answers, notes, and status. Write failures are tool errors, not successful exports.

Ordinary and background tool calls, including a connected external UI's foreground result, are captured. Recovering an interrupted tool request completes its original journal key when present. `/answer`, command replay, and ordinary chat do not create journal requests. Existing sessions without journal entries are not reconstructed. The journal does not automatically reuse answers, create tasks, or write files except through explicit export calls.

## Supported UX

- tabbed multi-question flow
- single-select, multi-select, and preview questions
- optional warning-colored recommendation subtitles in standard and preview option lists without automatic selection
- active question type changes via configurable `main.changeQuestionType` hotkey, default `t`; non-preview questions toggle `single <-> multi`; preview questions toggle `preview <-> multi`
- inline free-form answers for all question types
- native pi-style `@` file path autocomplete inside free-form answer and note editors
- question notes via `Shift+N`
- option notes via `n`
- number-key quick selection
- submit/elaborate/cancel review tab
- on the review tab, `Submit` and `Cancel` preview notes only for answered questions
- on the review tab, `Elaborate` preview expands to all question notes and all option notes, including notes on unselected options
- transcript-friendly call and result rendering
- `/answer` command to convert the latest completed assistant message into an `AskParams` form through a synthetic `ask_user` tool call and open the ask UI
- `/answer` extraction may use an internal `freeform: true` option for open-ended questions with no explicit choices; these render as user-input-only questions with the label `Type your answer:`, no numbered option row, and no selection caret; this marker is not part of the public `ask_user` tool contract
- `/answer:again` command to replay the latest `/answer`-extracted form on the current branch
- `/ask:replay` command to replay the latest real `ask_user` form on the current branch
- automatic recovery of the newest unresolved `ask_user` form on startup, resume, or fork
- ask settings list with binary behaviour/notification toggles and a guarded reset-to-defaults action
- `?` in the ask flow and `/ask-settings` in pi open the same lightweight ask settings overlay
- settings attempt to persist immediately when changed: `Auto-submit when answered without notes`, `Confirm dismiss when dirty`, `Double-press review shortcuts`, `Notifications`, and `Show footer hints`; `Present single-select as multi-select` persists immediately when saving succeeds but applies only to new/replayed ask flows; save failures revert the setting and show a manual-edit message; resetting config to defaults requires pressing the reset action twice within a short confirmation window
- `Keymaps` is a persisted, context-aware config section for global, main-flow, editor, note-editor, and settings-modal actions
- the settings list shows the absolute config file path for customizing keymaps, notifications, and extraction settings
- if the flow is already on the review tab, all questions are answered, and no notes exist, enabling auto-submit can complete the current ask flow immediately
- elaborate results are phrased as direct follow-up instructions, for example: `User asked to elaborate on question "Which option would you like to select?" option "Option A" with note "why this one?"`

## Keyboard behavior

Main flow:

- `global.settings` opens ask settings; default: `?`
- `global.dismiss` dismisses the active ask surface; default: `Ctrl+C`
- `main.nextTab` / `main.previousTab` move between tabs; defaults: `Tab`/`Right`, `Shift+Tab`/`Left`
- `main.nextOption` / `main.previousOption` move between options or review actions; defaults: `Down`, `Up`
- `main.confirm`, `main.cancel`, and `main.toggle` confirm, cancel, or toggle; defaults: `Enter`, `Esc`, `Space`
- cancelling or dismissing the whole form stops the current agent operation, for both foreground and background forms; dirty-dismiss confirmation still applies; closing an editor or settings does not stop the agent
- a background cancellation is recorded and can be delivered as context, but never starts a new agent turn by itself
- `main.changeQuestionType` changes the active question type (non-preview: `single <-> multi`; preview: `preview <-> multi`); default: `t`; destructive `multi -> single` changes require pressing the type hotkey again, with no timeout, and the pending confirmation clears on other navigation/actions
- `main.optionNote` and `main.questionNote` open option/question notes; defaults: `n`, `Shift+N`
- `1..9` is fixed and selects or toggles the matching option; on the review tab, `1`, `2`, and `3` trigger `Submit`, `Elaborate`, and `Cancel`
- when `Double-press review shortcuts` is enabled, review-tab `1`, `2`, and `3` require the same key twice without a timeout, and the review screen shows an inline hint for the pending action

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

Connected foreground calls stay pending until an explicit answer or cancel. pi-ask loads file previews, applies `presentSingleAsMulti`, validates question ids and values, and builds the normal result with locally computed labels and indices. Cancel stops the current agent operation, as in TUI. Operation abort closes the external form; late responses cannot change the result. UI disconnection, rejection, or a malformed returned response is a tool error, not an invented answer or user cancellation. All terminal paths remove the active flow and abort the provider's signal.

The native TUI remains the default and never negotiates an external surface. This contract does not transport TUI components, settings, commands, replay, or background queues. The external UI owns its layout and transport; pixel parity and universal extension support are not promised. See [external UI negotiation](remote-events.md#external-ui-negotiation) for the adapter API.

The public tool schema requires question `id` and `prompt` plus option `value` and `label`, and it restricts question `type` to `single`, `multi`, or `preview`, so malformed structural fields fail before execution. The tool still validates trimmed text, uniqueness, option counts, and preview requirements during execution and returns structured issues for those failures. Result rendering falls back to Pi's raw tool-error text when schema validation prevents execution.

The ask flow subscribes to runtime settings updates while open. In practice, this means changing `Auto-submit when answered without notes`, `Confirm dismiss when dirty`, `Double-press review shortcuts`, `Notifications`, `Show footer hints`, resetting config to defaults, or reloading config-backed keymaps can affect the in-progress ask flow immediately instead of only future asks when the change is saved or otherwise applied in memory. Load-time migrations and invalid config handling do not rewrite, rename, or back up the config file; invalid files load defaults for the session and show a notice. `Present single-select as multi-select` is applied when an ask flow is created and does not rewrite question semantics for an already-open flow; use `main.changeQuestionType` for live per-question changes.

## Notifications

When enabled, pi-ask emits one best-effort external notification per ask session after the ask UI opens and waits for input. The default title is `pi ask`; the message is `Question waiting: <label or prompt>`. Channels run in configured order and failures never fail or cancel the ask flow.

## Herdr blocked lifecycle

For interactive TUI ask flows, the extension optionally emits on `pi.events`:

- `herdr:blocked` with `{ active: true, label: "Waiting for user response" }`
  immediately before waiting for input;
- `herdr:blocked` with `{ active: false }` in the terminal cleanup path.

The cleanup event is emitted for successful answers, cancellation, abort/timeout,
and UI errors. This signal is status-only: it does not include questions, context,
answers, notes, or remote submission data. Non-interactive execution does not emit
this lifecycle.

## Remote inter-extension events

pi-ask exposes a local `pi.events` contract for trusted Pi extensions. It does not expose a network API and does not automate terminal keystrokes. RPC or headless integrations should use a trusted in-process bridge extension that consumes these events rather than expecting the TUI-only custom surface to open.

Channels:

- `@eko24ive/pi-ask:started`
- `@eko24ive/pi-ask:completed`
- `@eko24ive/pi-ask:submit`
- `@eko24ive/pi-ask:submit-result`

Remote submissions must be explicit `{ kind: "answer" }` or `{ kind: "cancel" }` responses. Remote answers use question ids and normalized option values from the started event. pi-ask validates ids and values, recomputes labels/indices, and does not infer approval semantics from labels.

See [`remote-events.md`](remote-events.md) for payload shapes, examples, and a local smoke test.

## Slash command replay/extraction

- valid `ask_user` payloads are persisted as branch custom entries before the UI opens, so `/ask:replay` can reopen them after cancel, `/resume`, or `/tree`
- `/answer` scans the current branch for the latest assistant message; if that message did not finish with `stop`, extraction is refused
- `/answer` sends the preceding user message as context with the latest assistant text and asks the extractor for one synthetic `ask_user` tool call
- missing or invalid tool calls are retried according to `answer.extractionRetries`; raw or fenced JSON text remains supported as a last-resort fallback
- `{ "questions": [] }` from extraction means no questions were found and is not treated as an invalid ask payload
- command-flow cancellation closes with a notification and does not send a message to the agent
- submitted or elaborated command-flow results are sent back with user-message semantics
- replay commands scan only `ctx.sessionManager.getBranch()`, ignore sibling/future branch payloads, and revalidate stored payloads before opening the UI

## Interrupted ask resume

- on `session_start` with reason `startup`, `resume`, or `fork`, pi-ask finds the newest `ask_user` tool call on the active branch that has neither a tool result nor an `ask:pending-dismissed` entry
- recovery does not run for `new`, `reload`, or non-TUI sessions
- the matching valid `ask:payload` supplies the form; if it is missing or invalid, pi-ask validates and uses the original tool call arguments instead
- the recovery flow is detached from `session_start`, so an open form does not block other lifecycle handlers
- because the interrupted `execute` promise no longer exists, submit sends the result with the same user-message semantics as replay commands
- submit and cancel both append `ask:pending-dismissed`, which prevents another automatic reopen; `/ask:replay` still works
- recovered flows emit remote lifecycle events with source `ask:resume`

The fallback message includes normalized pending questions and options so the caller can re-ask them manually. `details.questions` still contains normalized question metadata, while `details.answers` stays empty until a user responds.

## Skill alignment (advisory)

The auto-bundled skill profile at `skills/ask-user/SKILL.md` defines agent-side decision-gate guidance for when to call `ask_user`. It is enabled by default when the package is installed, but can be disabled via `pi config`.

It is advisory only. If there is any conflict, contract + tests win.

## Source of truth

Behavior should be verified against:

1. `src/types.ts` and exported state/result helpers
2. `tests/*.test.ts`
3. this contract
