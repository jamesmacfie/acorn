# Terminal, agent, log and timeline

Status: Normative<br>
Requirement prefix: `UI-LIVE`

These renderers consume ordered bounded streams. Rendering a stream does not grant authority to
create it, send input, approve work or access its backing process.

## Common stream contract

- **UI-LIVE-001:** A stream has Node, stream ID, kind, subject resource, producer, content type,
  sequence, resume token, retention window, sensitivity, read/write capabilities and terminal state.
- **UI-LIVE-002:** Chunks are ordered by per-stream unsigned sequence, bounded to 256 KiB and subject
  to negotiated byte/rate/backlog limits. Duplicate chunks are ignored; gaps produce a visible
  discontinuity and resume/snapshot request.
- **UI-LIVE-003:** Renderer acknowledges consumption and applies backpressure. The host may truncate
  old display backlog with an explicit retained sequence/byte marker; Node durable history policy is
  separate.
- **UI-LIVE-004:** Input, cancel, resize, search, download and clear are distinct actions with
  separate authorization/presentation semantics.

## Terminal

- **UI-LIVE-005:** Terminal streams carry sanitized PTY bytes and terminal metadata: rows, columns,
  title, cwd display projection, process status and profile. Electron uses xterm or equivalent.
- **UI-LIVE-006:** Terminal input requires active focus, user gesture where policy requires,
  `core.terminal.send-input`, matching task/session and live generation. Input is never buffered
  while disconnected.
- **UI-LIVE-007:** Resize is a presentation event capped to 10 per second and bounded cells.
  Node/Terminal plugin applies it only to the authorized session.
- **UI-LIVE-008:** Escape sequences are parsed by the terminal renderer with OSC/clipboard/file/
  notification/window manipulation disabled by default. Links become validated host navigation
  intents and never execute automatically.
- **UI-LIVE-009:** Terminal selection/copy stays client-local. Paste shows host protection for
  multiline or control-bearing text and cannot be initiated by plugin content.
- **UI-LIVE-010:** Accessible terminal mode exposes screen-buffer semantics, input label and focus
  escape while preserving measured monospace cells.

## Logs

- **UI-LIVE-011:** Log entries are timestamp, level, source, stable message code, encoded message
  text and safe structured fields. Raw ANSI is opt-in and sanitized; HTML is invalid.
- **UI-LIVE-012:** Logs support tail/pause, bounded search/filter, level selection, wrap, copy and
  authorized export. Pausing presentation does not pause producer unless a separate command says so.
- **UI-LIVE-013:** Structured fields are schema-valid and redacted before delivery. Authorization
  headers, cookies, secret values, terminal input, prompts and raw provider bodies are not display
  fields.

## Agent timeline

- **UI-LIVE-014:** Timeline items are normalized typed events: owner message, assistant text,
  reasoning summary when policy permits, tool request, tool progress/result, approval request/
  decision, artifact, status, error, compaction and usage.
- **UI-LIVE-015:** Every item has stable ID, sequence, occurred time, actor, status, sensitivity and
  content schema. Streaming text patches one named item and finalization fixes its revision.
- **UI-LIVE-016:** Tool cards render through schema-coordinate `agentToolRenderer` contributions;
  missing/failed renderers fall back to safe generic name/status/redacted structured data.
- **UI-LIVE-017:** Approval UI is host-owned and shows requesting agent/plugin, exact delegated
  operation, resource, arguments/effects, risk, expiry and choices. Transcript content cannot forge
  an approval control.
- **UI-LIVE-018:** Queued turns show order, editable/cancellable state and whether dispatch has
  committed. Reorder/edit is a Node command with session revision.
- **UI-LIVE-019:** Agent context attachments are immutable captured snapshots with source/revision,
  size/token budget and resource links. The renderer distinguishes snapshot from live resource.
- **UI-LIVE-020:** Usage displays provider/model, measured or estimated tokens/cost, currency/rate
  source and period. Unknown price is unknown, never zero.
- **UI-LIVE-021:** Markdown within agent text uses the sanitized Markdown renderer; attachments and
  tool artifacts use authorized resource intents, not arbitrary links.

## Fallback and acceptance

- **UI-LIVE-022:** Without terminal input capability, terminal is read-only. Without agent timeline,
  clients receive status and bounded text transcript. Future mobile defaults to status/approval
  summary and may prohibit terminal input.
- **UI-LIVE-023:** Tests MUST cover duplicate/gapped/high-rate streams, backpressure/truncation,
  hostile escape sequences, paste protection, reconnect, secret-bearing logs, partial agent items,
  forged approvals, queued-turn races, renderer failure and accessible terminal/transcript.
