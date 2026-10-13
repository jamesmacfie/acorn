# UI performance

Status: phases 01 to 05 landed October 13, 2026, and their plans are removed. Phases 06 to 10 are
planned. Baseline: `6d9efa88f`.

Phases 01 to 05 measured in Node or jsdom, because an agent-launched window is always hidden. Their
real-window numbers are still open. Each dated page below lists the numbers a person still needs to
take with the [streaming replay](../../local-development/streaming-replay.md).

This programme makes the desktop cost less in three moments: while an agent streams, when you switch
back to a session, and while nothing changes. It also gives Acorn a way to measure those costs in the
real window. The ideas come from a review of zeron (`references/zeron` at `053ce2ea`), a native Rust
client for coding agents. Its performance write-ups are `references/zeron/docs/performance-*.md` and
`references/zeron/docs/whale-ui-responsiveness.md`.

Zeron's raw speed comes mostly from drawing natively on the GPU, which Acorn can't copy. These phases
take its techniques, not its renderer.

Phases 06 to 10 come from a different source: a day of real use recorded in Sentry, written up in the
[Sentry baseline](../../testing/sentry-baseline-2026-10-13.md). They fix what made the window wait or
the machine fill up that day, including two causes outside the renderer: `git` calls in the Node and
agent provider processes.

## The phases

| Phase | Deliverable | Prerequisites |
| --- | --- | --- |
| 01 Streaming replay, landed | [Streaming replay](../../local-development/streaming-replay.md) and its [first check](../../testing/streaming-replay-2026-10-13.md). | None. |
| 02 Open-fence highlighting, landed | [Markdown renders block by block](../../ui-design/kit-internals.md#markdown-renders-block-by-block). | None. |
| 03 Incremental Markdown, not built | [Markdown parse cost check](../../testing/incremental-markdown-parse-2026-10-13.md), which holds the design if the real window shows the cost. | 01. |
| 04 Session revisit, landed | [Session revisit check](../../testing/session-revisit-2026-10-13.md). | 01. |
| 05 Idle cost, landed | [Idle cost check](../../testing/idle-cost-2026-10-13.md). | 01. |
| [06 Git calls in checkout admission](./06-checkout-admission-git.md) | Looking up a task's folder starts no `git` process when the repository is already known. | None. |
| [07 Session-open timeouts](./07-session-open-timeouts.md) | `agents.session.open` measures only opens that drew something. | None. |
| [08 Agent process memory](./08-agent-process-memory.md) | Idle provider processes stop once their total memory passes a limit, and Sentry shows how long each was idle. | None. |
| [09 Renderer memory](./09-renderer-memory.md) | A written answer to what holds the window's memory at its peak, and a fix for anything unbounded. | Before 04. Ideally after 10. |
| [10 Response size](./10-response-size.md) | The settings and session-list responses carry only what their screens draw. | None. |

Phases 06 to 10 don't need 01, because Sentry already measures them. Start with 06: it's the
smallest change with the widest effect, since half the git and editor routes wait on it. Do 07 early
too, so the session-open numbers are honest before anyone judges 04 with them. Phase 08 frees the
most memory. Phase 04 landed before 09, so 09 must count the transcript projections that 04 keeps
for the three most recent sessions.

Phases 06 to 10 compare a full working day in Sentry with the baseline, not alternating builds in a
replay. Record each after-day in a dated page under `docs/testing/`, beside the baseline.

## Rules for every phase

- Measure in the real window, not only in jsdom. A `pnpm dev:agent` window that's hidden runs at
  background priority, so keep it visible.
- Compare builds in alternating order: base, candidate, candidate, base. Report both runs of each, so
  the spread between two runs of the same build is visible next to the difference.
- Record dated results in a page under `docs/testing/`, and keep raw reports out of the repository
  when they contain transcript text.
- Keep the transcript's refused designs refused: no virtualizer, no `content-visibility`, and no
  dropping events to meet a budget. [The transcript](../../managed-agents/transcript.md#the-window)
  says why.
- Keep the selection rule. A streamed message re-renders only its growing block, so a selection
  across earlier paragraphs survives. `Markdown.test.tsx` checks this.

## Out of scope

- A native renderer, or moving the transcript off the webview.
- Node-side costs other than those in phases 06 and 08. The Node's event coalescing and ledger already
  have their own measurements in [the transcript store](../../managed-agents/transcript-store.md).
- Startup bytes. [The startup budget](../../frontend/startup-budget.md) owns them.
