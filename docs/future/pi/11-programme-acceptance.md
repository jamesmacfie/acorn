# Phase 11: programme acceptance

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phases 01–10 have
accepted handoffs or their expressly permitted fallback/removal outcomes. This is the final phase.

## Completion note, 2026-10-07

**What landed.** On branch `phase-11-programme-acceptance`, at the commit titled "Phase 11: Programme
acceptance", on top of phase 10's `0dfa0f980`. The combined flow ran on a real Claude Code session,
an unattended workflow, a plain Node, the terminal client, and phase 01's stored data. Three fixes
came out of it, each small and additive:

- **Published agents types.** An outside plugin could declare every contract in its manifest but got
  no TypeScript types for most of them, because the types lived only in
  `plugins/agents/src/contract/`. In-repo compiled consumers hid the gap. A packed
  `acorn-plugin-types` now carries `packages/plugin-types/src/contracts/agents.ts`: the permission
  subject and the `before-permission`, `before-tool`, and `after-tool` payloads, the messenger and
  follow-up entries, the review-input, activity, session-control, and requests capabilities, and the
  `generateText` request and result. `tools/arch/agentContract.test.ts` holds each one to its source
  in both directions. The published surface pin gained 139 lines and lost none. A scratch plugin that
  installs only the packed tarballs typechecks with no errors. Each owning page says what to import.
- **The `models` trust line is high.** It reads "Generate text with your model providers and
  installed agent CLIs, which spends their usage". It was the one spending grant not marked high,
  although the messaging line is high for starting a provider turn. `permissionLines.test.ts` covers it.
- **Codex's own approval reviewer is a named coverage limit.** The person's `~/.codex/config.toml`
  sets `approvals_reviewer = "auto_review"`. Codex then approves its own requests, and none reaches
  `agents:before-permission`. [Permission policy](../../managed-agents/permission-policy.md#what-it-doesnt-do)
  says so.

Docs updated: the [programme overview](./README.md) (status, reach list, and an outcome per phase),
[node extension points](../../plugins/node-side-extension-points.md) (the permission hook beside
the loop hooks), [skills](../../managed-agents/skills.md) (native delivery is Claude Code and Codex
only), [permissions](../../plugin-authoring/permissions.md), phase 03's tense about the review
reader, and manual check 165 in [agents and providers](../../testing/agents-and-providers.md), which
reproduces the combined flow. The [future index](../README.md) row records the result. The [Mods design](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md),
now removed from main, stays in Git history. No migration and no wire change.

**Disposition of every phase.**

| Phase | Disposition | Owning contract | Still open |
| --- | --- | --- | --- |
| 01 | Accepted with limitations | [Harnesses](../../plugin-authoring/harnesses.md#harnesses) | `omp` isn't installed. The in-app cards, the extension, and its advisor variant wait for a signed-in `omp`. |
| 02 | Accepted with limitations | [Permission policy](../../managed-agents/permission-policy.md) | A Codex refusal: this run's request was answered by Codex's own reviewer, as above. DeepSeek and `omp` aren't installed. |
| 03 | Accepted with limitations | [Session messages](../../managed-agents/session-messages.md) | The Codex explanation, for the same reason. |
| 04 | Accepted with limitations | [Plugin model grants](../../integrations/model-providers.md#plugin-model-grants), [review input](../../managed-agents/session-events.md#review-input) | The connection-backend charge on a real host. This machine has no provider key. |
| 05 | Accepted with limitations | [Unattended follow-ups](../../managed-agents/unattended-follow-ups.md) | Proven here: the advisor's own correction of a workflow step. Still open: a real delegated run. |
| 06 | Accepted | [Skills](../../managed-agents/skills.md) | None beyond the harness matrix. |
| 07 | Accepted | [Native skills](../../managed-agents/native-skills.md) | DeepSeek and `omp` keep the index, by design. |
| 08 | Removed | None. No product code shipped | The benchmark stays in [`packages/resource-read-benchmark/`](./packages/resource-read-benchmark/README.md). |
| 09 | Accepted with limitations | [Activity](../../managed-agents/session-events.md#activity), [session control](../../managed-agents/session-control.md), [remote points](../../plugins/remote-points.md) | A Codex subagent in the meter. |
| 10 | Accepted with limitations | [Harness bridges](../../managed-agents/loop-hooks.md) | Codex, DeepSeek, and `omp` have no bridge. Codex can't take a trusted hook from a host. |

**Consumer revisions.** All four install by folder with no build step: permission policy 0.5.0,
advisor 0.2.0, `pi-skills` 0.1.0, and session meter 0.1.0, under [`packages/`](./packages/). The
`omp` harness package is 0.1.0. Post `{ "source": { "path": "<checkout>/docs/future/pi/packages/<name>" } }`
to `POST /v1/core/plugins/install` with an `Idempotency-Key` UUID, restart the Node, and accept each
prompt. Don't send an `Idempotency-Key` to a loaded plugin's own route, which answers 500 (phase 04).

**Provider matrix.** Claude Code 2.1.292 through `@agentclientprotocol/claude-agent-acp` 0.54.1 ran
the sessions on Opus 5.5 and the advisor on Haiku. Codex 0.159.2 ran one session. `omp` and `dsh` are
not on this machine, and no model-provider key is configured.

**Migrations.** The programme added one: core `0004_plugin_model_grants` (phase 04). A copy of phase
01's data root, from before that migration, booted on this build. It migrated to five core
migrations with `plugin_model_grants` and `plugin_model_calls`, kept all 19 plugins active, listed its
seven Claude and `omp` sessions, resumed a Claude session to a new turn, and listed both agent CLIs
as Generate backends. The person's own Claude skills were still in that session's command list.

**Real host, combined flow.** `pnpm dev:agent -- --session pi-phase-11 --project /tmp/p11-repo`, a
throwaway repository with `add` and `multiply` and a `node --test` suite:

1. The four packages installed through the route and were `active` after a Node restart. The trust
   prompts kept generation, review input, notes, and unattended review as separate lines, with the
   generation line marked high (`p11-01-after-restart.png`). The skill prompt wrote its digest.
2. One turn added `subtract` and used the skill. The transcript says "Skills the agent can load:
   acorn-pi-skills:release-note (native).", the agent read `format.md` from `agent-skills/`, and the
   note ends "Formatted with the pi-skills release-note procedure." (`p11-04-blocked.png`).
3. `rm -rf /tmp/p11-outside` failed in the same turn, and the agent quoted "Blocked by
   acorn-permission-policy: rm would remove /tmp/p11-outside, outside this task's worktree." The
   folder survived. A bridge refusal reaches the model in its turn, so no explanation note was sent,
   as phase 10 designed.
4. With `add` changed to `a - b` by hand, a request for `modulo` drew a blocker from the advisor. A
   turn labelled **From acorn-advisor** followed, and the agent answered it (`p11-03-advisor-note.png`).
   The advisor reviewed the four person-sent turns and never its own note's turn, so there was no loop.
   The first try missed the change: `git diff HEAD` still held the earlier turns' work, and the
   advisor flagged that instead. Its finished-answer concern was recorded and not sent.
5. A one-step workflow on the same tree: the advisor reviewed the step in 20.5 seconds, inside the
   30-second window. Its note ran as a plugin turn in the step's session, the operation recorded
   `reviewed`, and the step's published result is the agent's reply to the note. This is the real-host
   correction phase 05 couldn't show.
6. With the allowance set below the day's spend, the next workflow's review failed with
   `provider_budget_exhausted`, the advisor page showed the reason, nothing more was charged, and the
   step finished. The window was reloaded mid-run as a stand-in for a disconnected client, and the run
   finished on the Node regardless.
7. Disabling the advisor mid-review left its window open until the 30-second deadline, recorded as
   `timed-out`. The step finished, no turn was left open, and the call stayed charged.
8. After a Node restart, the plugin turns (2), review jobs (8), and notes (3) were unchanged. The
   resumed Claude session's bridge refused `git push --force nowhere-remote HEAD` with the policy's
   reason, so a resume reinstalls the hooks.

The four advisor reviews of interactive turns took 34.6, 21.3, 31.8, and 16.3 seconds on Claude Code
Haiku through the CLI. The slowest reported 3,226 output tokens for a short JSON verdict. A synthetic
review from a shell took 5 to 6 seconds at any effort level, so the time tracks how much the model
writes on the real prompt, not process start. The advisor's settings already say an owner waits up
to 30 seconds.

**Codex.** One session asked to run `rm -rf /tmp/p11-outside`. The person's Codex config sends
approvals to Codex's own reviewer, which approved, so the request never reached acorn. The
transcript shows only "Automatic approval review approved". Codex also read the prompt's trailing
period as an argument and tried `rm -rf /tmp/p11-outside .`. `rm` refused to remove `.`, Codex's
sandbox refused the outside folder, and the repository was unchanged. Check 156's Codex half needs a
Codex home without `approvals_reviewer`.

**Plain Node and terminal client.** `ACORN_DATA_DIR=<dir> node --import tsx src/entries/standalone.ts`
from `apps/node`, on Node 26.8.1, with no desktop process, booted in about 3 seconds. All four packages
installed, ran after a restart, and answered their routes. The skill grant posted by digest. Nothing
tried to load Tauri, Electron, or the shell helper, and SIGTERM drained in under 2 seconds. A source
run has no built `loop-hook.js`, so coverage listed Codex only, as the contract says. The built
`standalone.js` needs its externals, which only the packed tarball installs. The terminal client,
`pnpm dev:tui:agent -- --session pi-phase-11-tui --project /tmp/p11-repo` with the packages linked
into its data root, showed each trust prompt at 80 by 24 and 120 by 40 with the same separate lines,
and **Run it** on the skills prompt wrote that Node's `skill-state.json`.

**Commands run.**

- `pnpm lint` passes.
- `pnpm test` on Node 24.11: 31 of 36 tasks passed. `@acorn/client-core` 2,461 passed on a rerun
  after the trust-line change, with the known `scopes.test.ts` and `cssHygiene` failures. `@acorn/desktop` 171 passed, with the 11 known
  `clientPluginDisable.test.ts` cases. `@acorn/plugin-agents` 1,174, `@acorn/protocol` 294, and
  `@acorn/plugin-workflows` 568 passed. `@acorn/node-core`, `@acorn/node`, and `@acorn/tui` need Node
  26.8.1 for their worker tests.
- On Node 26.8.1: `@acorn/node-core` 1,628 passed, with the 3 known `storage/backup.test.ts` failures.
  `@acorn/node` 272 passed, with the known `routeRegistry.test.ts` terminal route. `@acorn/tui` 676
  passed.
- After the types change: `acorn-plugin-types` 5, `@acorn/arch-tests` 87, `acorn-plugin-sdk` 12, and
  `create-acorn-plugin` 22 on Node 26.8.1. `permissionLines.test.ts` 38.
- The desktop test command wasn't rerun, because no desktop runtime or packaging changed.

Screenshots are in the ignored `.acorn/agent-dev/pi-phase-11/screenshots/` and
`.acorn/agent-dev/pi-phase-11-old/screenshots/p11-old-data.png`.

**Limitations.** Each leaves its acceptance row open, with the evidence above.

- **Node switching wasn't exercised.** Each client here ran one Node, and pairing a second one needs
  the enrollment flow, which no driver reaches. Grants, skill state, plugin trust, and notes are
  read from the Node's own data root and query cache, and the plugin pages hide Node-owned sections
  for another Node.
- **No delegated run.** Phase 05's limitation stands. Its path is covered by `turnFollowUps.test.ts`.
- **Stop during review, a provider disconnect, and restart during an unattended operation weren't
  forced on the real host.** Phase 05's tests cover them, and its real host showed a cancel during
  generation.
- **Disabling a reviewer doesn't close its window early.** The owner waits out the rest of the 30
  seconds. That's bounded, so it isn't changed here.
- **After a Node restart, Claude can list a native skill a few milliseconds after the first turn.**
  This run measured 7 ms. That turn gets the skill through acorn's list instead, the fallback phase 07
  designed.
- **The terminal trust prompt cuts a long line at the box edge.** At 120 by 40 the unattended-review
  line ends at "which can hold their results".
- **The `MODULE_TYPELESS_PACKAGE_JSON` warning.** The three code packages have no `package.json`, so
  Node re-parses each `node.js` as an ES module and warns. Harmless.
- **A wrong `providerId` on `POST /v1/p/agents/sessions` answers a bare 500.** It should be a 400.
  Flagged for separate cleanup.
- **DeepSeek and `omp` weren't run,** and no connection backend was available.


## Outcome

A developer can demonstrate the combined features from a fresh isolated installation, and every
implemented public contract has one owning reference page. This phase closes integration risks
between accepted slices; it does not widen the programme.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Loaded omp harness | Install, start, approval, question, resume, and recorded workflow/delegation support or phase 01 limitation. |
| Permission policy | Block once on each supported harness, timeout to human review, resolved reason on both clients, no parent wake. |
| Plugin messaging | Busy/idle delivery, stable host attribution, restart idempotency, cap, and revoked contributor refusal. |
| Model grant and advisor | Unconfigured/off makes no call; correct backend/model, conservative allowance, repeat suppression, and one correction. |
| Unattended ownership | Workflow/delegation final result waits for admitted corrections; cancel/timeout/budget/restart leave no orphan turn. |
| Plugin skills | Manifest-only package, trust update, supporting asset load, disable/resume, portable/native matrix, and no worktree writes. |
| Session reach | Activity pane rebuilds mid-session on each harness, option change validated and attributed, warn-only note on a pending request. |
| Harness bridges | Bridge veto, `ask`, and after-tool note on Claude and Codex, or a recorded Codex limitation; no bridge reply ever approves; coverage shown per harness. |
| Resource experiment | Reproducible pass with default off, or complete removal with paired evidence retained. |
| Node and client scope | Headless execution, disconnected clients, remote/selected-Node separation, and additive stored-state compatibility. |

## Implementation and review

1. Reconcile every handoff's contract names, migrations, loaded consumer revisions, and provider
   versions. Build/install policy, advisor, skills, session meter, and `omp` packages from the supplied source into
   a fresh isolated profile. Verify required scaffold/type/SDK changes are available to an external
   developer; local compiled consumers must not mask missing published declarations.
2. Run one combined interactive flow: select a skill, perform work, trigger a denied command, read
   the attributed explanation, complete a bad change, and receive an advisor correction. Confirm
   plugin-origin turns do not cause review loops and explanations cannot evade the message cap.
3. Run the same consumers on an owned workflow/delegation operation. Exercise stop during review,
   exhausted allowance, provider disconnect, Node restart, and plugin disable. Confirm result and
   parent report ordering, accounting, and cancellation from the user's surfaces and durable state.
4. Exercise both clients and a client-disconnected Node. Switch between Nodes with matching task IDs
   while settings and transcripts are cached. Verify model grants, skill paths, plugin trust, and
   messages do not cross Node scope. Restore older data without resetting it and check ordinary
   sessions, approvals, configured Generate buttons, MCP tools, and user-provided skills.
5. Review the final trust prompts and owning docs against the implementation. Keep hook veto,
   `ask`, messaging, review participation, model generation, session option changes, and skill
   instructions as distinct grants. State the permission hook's coverage limit, each harness's
   bridge coverage, the model cap's managed-path limit, advisor latency,
   unknown cost reporting, and unsupported native skill doors in user-visible copy where relevant.
6. Resolve integration failures at the owning layer and rerun the affected evidence. Do not repeat
   every benchmark or provider test without a concrete reason. A missing graphical/provider check
   leaves acceptance open; record exactly what is missing.
7. Run `pnpm lint`, architecture/doc checks, and `pnpm test` through the bounded root script. Retain
   real Tauri and PTY reports with inspected screenshots. Verify a plain Node boots and consumes the
   loaded packages without desktop bindings. Use the desktop test command only when its runtime or
   packaging changed.

## Documentation disposition

Update [programme overview](./README.md) and [future index](../README.md) with delivered phases
and remaining acceptance. Keep the Mods comparison; move the implemented hook contract to
[node extension points](../../plugins/node-side-extension-points.md) and
[managed agents](../../managed-agents.md), linking rather than duplicating it.

Each phase's design must point to its shipped owning contract or its refused/deferred outcome.
Retain benchmark results and provider limitations as dated evidence. Remove stale claims that the
review reader ships before phase 04, that every harness receives native skills, or that all plugin
spending is capped. Index every retained phase and document through the existing docs indexes.

## Final handoff

Record the accepted implementation revisions, standalone consumer source and install instructions,
provider matrix, migrations, test commands/results, and real-host evidence. State whether phase 08
was retained or removed. A later developer should be able to reproduce the combined flow without
the original developer's machine or conversation history.

## Verify before building

Read all preceding handoffs and their acceptance records. Recheck the release/manual-check owners,
fresh-profile boot procedure, packaging of content-only plugins, public declarations, and which
graphical/provider checks require a host that is not available in the development environment.
