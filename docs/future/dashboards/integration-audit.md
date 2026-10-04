# Dashboard programme integration audit

Status: integrated on 2026-10-04. This is the acceptance inventory for workstreams 1–7. The phase
completion notes record what each task knew at the time; the owning product docs describe the code
after integration. "Implemented" below means the contract and fixture behavior are present. It does
not mean a live account or human panel request was exercised.

| Phase | Mandatory shipped milestone and evidence | Expressly deferred or separate track | Remaining acceptance evidence |
| --- | --- | --- | --- |
| 01 Trustworthy results | Field references, publication checks, completeness, stable history identity, refresh, and display are in `dashboards-core`, Node publication and sampling, and client views. The Phase 01 completion record and its suites cover these paths. | None of its correctness requirements are deferred. | The original manual notes remain the historical record. |
| 02 Source-first editor | Version 2 plan persistence and upgrade, Node run/read planning, source-first and AI editor entrances, metadata/requirements validation, recovery, and the published client cache are implemented. The isolated desktop selected Workspace tasks and published a panel. | New connectors belong to the integration track. | Live-model evaluation and 20 unseen human-collected requests were not run. |
| 03 Identity, time, and sources | Account identity and viewer matching, list and workspace reach, relative/calendar time, covered ranges and observation, enriched GitHub pull requests and Actions jobs, local branches/worktrees/task counts, and per-event agent usage are integrated. Protocol, Node, provider fixture, and authoring tests cover these contracts. | The phase explicitly makes richer Linear fields, further GitHub sources, package manifests, activity events, and saved SQL sources **by demand**. Third-party connectors are a separate track. | No live GitHub/Linear or human request acceptance was performed. GitHub Actions uses an explicitly incomplete bounded REST scan rather than a provider continuation. |
| 04 Row actions and navigation | Row press, child buttons, full references, task promotion, targets, keyboard row menus, Node fresh named actions and idempotency, and summary drill-down are wired. GitHub Actions jobs expose **Re-run job** through that confined path; fixture tests exercise its fresh eligibility and refusal. | Terminal dashboard rendering is outside the desktop row-menu site. | No real GitHub job was re-run. |
| 05 Composition and analysis | Exact scoped relations, children, equivalence, repeated typed stages, summaries, time buckets, overlap, unit/currency refusal, partial provenance, and read-only drill-down are implemented in the plan runner and client editor. Add as panel now preserves the exact calendar bucket as a half-open range, including zone changes. Fixture suites cover stage and dataset parity paths. The isolated desktop summary drill-down and derived panel check below found exactly the two October contributors. | New provider-specific relation declarations require a provider that can attest their exact keys; the by-demand Linear expansion remains separate. | Human annotation of misleading combinations and live-provider relation acceptance remain open. |
| 06 Datasets and history | Three modes, capture and event coverage, scheduled capture, scoped workflow/agent writes, corrections, caps/retention, SQLite summary reduction, Settings Datasets, and Keep history are integrated. A disposable desktop dataset and daily capture were created from Workspace tasks. | Stat measure history remains separate by design. | Capture against a live provider and long-running retention behavior were not observed in the desktop session. |
| 07 Write-back | Per-source choice values, confined writable declarations and Node act, fresh state/authority checks, confirmation, stable retry keys, refusal, optimistic movement/rollback, card/header gesture separation, keyboard Move to, and editor/AI requirements are implemented. GitHub pull-request state is the declared provider mutation; fixture tests cover refusals and retries. The isolated desktop check below exercised the populated board's drop handler, cancellation, allowed write, and row menu against disposable records. | Read-only usage gate was explicitly waived by the owner for implementation; no usage numbers were invented. Unsupported provider writes are not invented. | No real provider record was changed. The desktop driver could not deliver a native drag gesture or keyboard Enter activation, so those interactions and human acceptance remain open. |

## Integrated paths checked

| Path | Result and limit |
| --- | --- |
| Source → query context → Node plan | Source descriptions carry identity, reach, coverage, relations, actions, and writable fields. Context resolves on the Node at one evaluation time, then bounded reads flow into mapped rows and partial diagnostics. |
| Composition → dataset → drill-down | Summary provenance stays attached to contributing records; aggregates and equivalent rows remain read-only for write-back. Dataset SQL reduction follows preceding filters and retains capture/event coverage separately. |
| Action → provider route | A row carries a scoped record reference and action ID. Node reauthorizes and asks the source for current eligibility, then dispatches only a plugin-confined route. The GitHub job route reads current job state and checks the selected repository and connection before POST. |
| Editor → publication → Home | In the isolated desktop, Add panel → Pick data opened the source list, Workspace tasks populated fields, Keep history created a snapshot dataset and schedule, Settings → Datasets listed it, and Pick data offered it. Publish drew the panel. A fresh one-tab workspace exposed New dashboard and created a second tab with inline rename. |

## Populated desktop fixture check (2026-10-04)

An isolated `dev:agent` desktop session installed a disposable, in-memory source through the normal
plugin install, source description, query, detail, and confined action seams. Its records were
`oct-one` and `oct-two` on October 2–3, and `sep-one` on September 15, 2026. The source declared
`/state` writable with `open` and `closed` values. The panel editor mapped those values explicitly;
all writes stayed in the session fixture. The screenshots are from the real published desktop panel.

| Interaction | Observed UI and persisted result | Evidence and limit |
| --- | --- | --- |
| Board drop, cancel, confirm | The board began Open 2 / Closed 1. Dispatching HTML `dragstart` → `dragover` → `drop` on the actual card and column showed `Change Disposable board records to closed?`. Cancel left counts at 2 / 1. Repeating the drop and confirming called Node act and moved `oct-one`, yielding Open 1 / Closed 2 and `Disposable board records updated.` | [Before](evidence/board-before.png), [confirmation](evidence/board-confirmation.png), [after](evidence/board-after.png). The desktop WebDriver's pointer actions emit mouse events, not native drag events; two pointer-sequence attempts caused no board change. The HTML drag events exercised the production handler, but physical pointer drag remains unverified. |
| Row menu move | `oct-two` exposed `Move to Open: Disposable board records is already in Open.` and `Move to Closed`. A WebDriver ArrowDown moved focus to `Move to Closed`; selecting that menu item showed the same confirmation, and confirming yielded Open 0 / Closed 3. | [Menu](evidence/board-keyboard-menu.png). The driver delivered ArrowDown but its untrusted Enter key event did not activate the focused button, so keyboard Enter activation remains unverified in this desktop run. The selection itself used the UI driver click. |
| Monthly summary and drill-down | A published table grouped `Occurred` by month and displayed October 2 / September 1. Clicking the October `2` opened `Rows behind this result` with `October one` and `October two`, and no September record. | [Contributing rows](evidence/summary-drilldown.png). In list view, pressing the summary row said `This row has no available destination.`; the table's measure button is the intended drill-down control. |
| Add as panel | `Add as panel` returned `Panel added.` and published `Monthly fixture counts · rows` containing only the two October records. A read-only check of its saved dashboard revision found a filter on `/occurredAt`: `>= 2026-09-30T11:00:00.000Z` and `< 2026-10-31T11:00:00.000Z`, the October 2026 bucket in `Pacific/Auckland`; the original summary's September count remained visible. | [Published derived panel](evidence/summary-derived-panel.png). This proves the saved half-open bucket restriction and result in the fixture session. It does not prove future live-provider refresh behavior. |

## Verification boundaries

The automated suite uses fixtures and test databases. It does not prove live provider permissions,
retention policies, latency, or human comprehension. The isolated desktop has its own data and ports;
no real provider record was modified. The original Phase 02/03 human and live-model evaluation gates,
Phase 05 annotation, native pointer drag and keyboard Enter activation in the published board, and
live write-back acceptance need separate evidence before claiming those outcomes. The programme's
by-demand sources and external integration track are not prerequisites for the shipped shared
dashboard contracts.
