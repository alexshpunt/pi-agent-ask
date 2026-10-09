# Integration events

`pi-agent-ask` exposes local `pi.events` events for trusted extensions in the same Pi process. It does not expose a network API or automate terminal keystrokes.

All integration channels use the `pi-agent-ask` prefix. Old `@eko24ive/pi-ask:*` listeners must be updated; there are no aliases.

## External UI negotiation

Foreground `ask_user` outside TUI mode emits `pi-agent-ask:external-ui` once per call, after validation and preview loading. This synchronous event lets a connected bridge offer a UI:

```ts
type ExternalAskConnection = {
  version: 1;
  mode: ExtensionContext["mode"];
  toolCallId: string;
  connect(provider: ExternalAskProvider): boolean;
};

type ExternalAskProvider = {
  version: 1;
  id: string;
  open(request: ExternalAskRequest): Promise<unknown>;
};

type ExternalAskRequest = {
  version: 1;
  flowId: string;
  toolCallId: string;
  title?: string;
  questions: AskQuestion[];
  signal: AbortSignal;
};
```

The bridge must check its host's connection and capabilities before calling `connect`. The first valid provider wins. Unsupported versions, another provider, and connections made after the listener returns are rejected. Environment variables alone are not a connection. Without a provider, the tool returns its normal cancelled non-TUI fallback.

TUI and non-TUI background calls do not emit this event. Background questions and settings remain TUI-only. No browser UI is bundled.

`open` receives cloned, normalized questions. Preview files have become text; types reflect `presentSingleAsMulti`. Keep `flowId` and `toolCallId` for correlation. Resolve with an explicit `RemoteAskResponse` as defined below. The original tool call waits; labels, indices, and result semantics are computed locally.

Listen to `signal` and close the UI/transport when it aborts. It aborts after an answer, cancellation, operation abort, or failure, including completion by another local submitter. Reject on disconnection or UI failure rather than inventing a cancellation. An invalid response or no response is a tool error. Late responses are ignored; late submit-channel requests receive `flow_not_found`. Terminal paths dispose the active flow and provider resources.

```ts
pi.events.on("pi-agent-ask:external-ui", (data) => {
  const connection = data as ExternalAskConnection;
  if (connection.version !== 1 || !host.isConnected()) return;
  connection.connect({
    version: 1,
    id: "my-host",
    open: (request) => host.ask(request),
  });
});
```

`host` is the bridge's transport, not a Pi API. The public types are in `src/external-ui.ts`. This API carries form data, not TUI components or keystrokes. External flows also use the lifecycle and submit channels below. UI failures dispose the flow without a completed answer event. Notifications and Herdr waiting status belong to the TUI surface.

## Lifecycle channels

- `pi-agent-ask:started`: a validated form opens.
- `pi-agent-ask:completed`: a form resolves.

```ts
type RemoteAskStartedEvent = {
  version: 1;
  flowId: string;
  toolCallId?: string;
  source: "tool" | "ask:resume";
  title?: string;
  questions: AskQuestion[];
  createdAt: number;
};

type RemoteAskCompletedEvent = {
  version: 1;
  flowId: string;
  toolCallId?: string;
  source: "tool" | "ask:resume";
  result: AskResult;
  completedAt: number;
};
```

Use question IDs and option values from the started event. `ask:resume` identifies an interrupted tool form. Recommendation markers are presentation metadata and do not change answer values or labels.

## Submit channels

Submit to `pi-agent-ask:submit`; receive the acknowledgement on `pi-agent-ask:submit-result`.

```ts
type RemoteAskResponse =
  | {
      kind: "answer";
      mode?: "submit" | "elaborate";
      answers: Record<string, {
        values?: string[];
        customText?: string;
        note?: string;
        optionNotes?: Record<string, string>;
      }>;
    }
  | { kind: "cancel" };

pi.events.emit("pi-agent-ask:submit", {
  version: 1,
  requestId: `bridge-${Date.now()}`,
  flowId,
  response: {
    kind: "answer",
    mode: "submit",
    answers: { questionId: { values: ["option-value"] } },
  },
});
```

Question keys and selected values must exist in the started form. An answer replaces the current answer set rather than merging stale UI state. `mode` defaults to `submit`; `elaborate` requests clarification. Labels and indices are recomputed locally. Notes and custom text follow the normal tool contract.

Cancel explicitly with `response: { kind: "cancel" }`. The extension never infers cancellation or approval from labels or button names.

```ts
type RemoteAskSubmitResultEvent =
  | { version: 1; requestId: string; flowId: string; ok: true }
  | {
      version: 1;
      requestId: string;
      flowId: string;
      ok: false;
      error: "flow_not_found" | "invalid_request" | "invalid_answer";
      message: string;
    };
```

Correlate responses with `requestId` and `flowId`. Do not assume ordering between `submit-result` and `completed`. An invalid submit leaves the form open so the UI can correct the response; an invalid resolved external-provider response is instead a tool error.

Third-party bridges own their UI policy and value mappings. They must use explicit values rather than ask the extension to infer approval semantics.

## Verify locally

The real-Pi tests cover TUI submission, connected external calls, failures, and cleanup:

```bash
pnpm exec pi-test run -- node --test tests/integration/external-ui.test.ts
```

For a manual check, load this extension and a trusted test bridge. Listen for `pi-agent-ask:started`, display its normalized questions, and submit an explicit response. Verify both the returned answer and `pi-agent-ask:submit-result`. See [the tool contract](contract.md) for result semantics.
