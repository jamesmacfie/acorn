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
| 05 Composition and analysis | Exact scoped relations, children, equivalence, repeated typed stages, summaries, time buckets, overlap, unit/currency refusal, partial provenance, and read-only drill-down are implemented in the plan runner and client editor. Add as panel now preserves the exact calendar bucket as a half-open range, including zone changes. Fixture suites cover stage and dataset parity paths. | New provider-specific relation declarations require a provider that can attest their exact keys; the by-demand Linear expansion remains separate. | Human annotation of misleading combinations and live-provider relation acceptance remain open. |
| 06 Datasets and history | Three modes, capture and event coverage, scheduled capture, scoped workflow/agent writes, corrections, caps/retention, SQLite summary reduction, Settings Datasets, and Keep history are integrated. A disposable desktop dataset and daily capture were created from Workspace tasks. | Stat measure history remains separate by design. | Capture against a live provider and long-running retention behavior were not observed in the desktop session. |
| 07 Write-back | Per-source choice values, confined writable declarations and Node act, fresh state/authority checks, confirmation, stable retry keys, refusal, optimistic movement/rollback, card/header gesture separation, keyboard Move to, and editor/AI requirements are implemented. GitHub pull-request state is the declared provider mutation; fixture tests cover refusals and retries. | Read-only usage gate was explicitly waived by the owner for implementation; no usage numbers were invented. Unsupported provider writes are not invented. | No real provider record was changed; graphical drag with a populated board and human acceptance remain open. |

## Integrated paths checked

| Path | Result and limit |
| --- | --- |
| Source → query context → Node plan | Source descriptions carry identity, reach, coverage, relations, actions, and writable fields. Context resolves on the Node at one evaluation time, then bounded reads flow into mapped rows and partial diagnostics. |
| Composition → dataset → drill-down | Summary provenance stays attached to contributing records; aggregates and equivalent rows remain read-only for write-back. Dataset SQL reduction follows preceding filters and retains capture/event coverage separately. |
| Action → provider route | A row carries a scoped record reference and action ID. Node reauthorizes and asks the source for current eligibility, then dispatches only a plugin-confined route. The GitHub job route reads current job state and checks the selected repository and connection before POST. |
| Editor → publication → Home | In the isolated desktop, Add panel → Pick data opened the source list, Workspace tasks populated fields, Keep history created a snapshot dataset and schedule, Settings → Datasets listed it, and Pick data offered it. Publish drew the panel. A fresh one-tab workspace exposed New dashboard and created a second tab with inline rename. |

## Verification boundaries

The automated suite uses fixtures and test databases. It does not prove live provider permissions,
retention policies, latency, or human comprehension. The isolated desktop has its own data and ports;
no real provider record was modified. The original Phase 02/03 human and live-model evaluation gates,
Phase 05 annotation, and live write-back acceptance need separate evidence before claiming those
outcomes. The programme's by-demand sources and external integration track are not prerequisites for
the shipped shared dashboard contracts.
