# Performance: the decisions, the refusals, and the numbers

This archive preserves dated measurements and design decisions. Use the [documentation index](./README.md) for behavior contracts.

## What was measured this time

<a id="performance-the-decisions-the-refusals-and-the-numbers"></a>
<a id="where-each-behaviour-lives-now"></a>
<a id="what-was-decided"></a>

[What was measured this time](performance/what-was-measured-this-time.md)

## The seven decisions

<a id="1-the-process-topology-stays"></a>
<a id="2-every-host-draws-first-then-connects-then-fills"></a>
<a id="3-registries-hold-loaders-not-values"></a>
<a id="4-the-node-owns-freshness-and-coalescing"></a>
<a id="5-streaming-surfaces-render-incrementally"></a>
<a id="6-one-query-client-per-node-on-every-host"></a>
<a id="7-the-terminal-clients-key-path-is-indexed-not-scanned"></a>

[The seven decisions](performance/what-was-measured-this-time.md#the-seven-decisions)

## Corrections to the first reads


[Corrections to the first reads](performance/what-was-measured-this-time.md#corrections-to-the-first-reads)

## What the phases found wrong with these seven

<a id="what-was-refused"></a>

[What the phases found wrong with these seven](performance/what-was-measured-this-time.md#what-the-phases-found-wrong-with-these-seven)

## Row patching instead of coarse `<noun>:changed` invalidation


[Row patching instead of coarse `<noun>:changed` invalidation](performance/what-was-measured-this-time.md#row-patching-instead-of-coarse-nounchanged-invalidation)

## A general topic or subscription model on `/v2/events`


[A general topic or subscription model on `/v2/events`](performance/what-was-measured-this-time.md#a-general-topic-or-subscription-model-on-v2events)

## Splitting the node into worker threads or multiple processes


[Splitting the node into worker threads or multiple processes](performance/what-was-measured-this-time.md#splitting-the-node-into-worker-threads-or-multiple-processes)

## Dropping unreferenced icons at build time


[Dropping unreferenced icons at build time](performance/what-was-measured-this-time.md#dropping-unreferenced-icons-at-build-time)

## Rebuilding the transcript virtualizer


[Rebuilding the transcript virtualizer](performance/what-was-measured-this-time.md#rebuilding-the-transcript-virtualizer)

## Single-theme diff tokens


[Single-theme diff tokens](performance/what-was-measured-this-time.md#single-theme-diff-tokens)

## Replacing base64 on the helper wire ahead of a measurement


[Replacing base64 on the helper wire ahead of a measurement](performance/what-was-measured-this-time.md#replacing-base64-on-the-helper-wire-ahead-of-a-measurement)

## Scrollback beyond the ring after phase 3


[Scrollback beyond the ring after phase 3](performance/what-was-measured-this-time.md#scrollback-beyond-the-ring-after-phase-3)

## Added 2026-09-02

<a id="collapsing-the-process-topology-or-holding-the-token-in-the-renderer"></a>
<a id="a-filesystem-watcher-for-worktree-status"></a>
<a id="rows-virtual-by-default-on-either-host"></a>
<a id="a-second-query-client-in-the-terminal-client"></a>
<a id="a-terminal-specific-keymap"></a>
<a id="dropping-the-tree-hosts-whole-batch-pre-flight"></a>
<a id="a-503-until-ready-node-contract"></a>

[Added 2026-09-02](performance/what-was-measured-this-time.md#added-2026-09-02)

## Added 2026-09-03

<a id="splitting-the-node-service-bundle-into-per-plugin-chunks"></a>
<a id="a-journal-check-in-front-of-drizzles-migrate"></a>
<a id="keepalive-dom-on-the-pane-contract"></a>
<a id="a-per-file-row-model-for-the-diff"></a>
<a id="virtual-opted-in-at-the-long-list-sites-in-cells"></a>

[Added 2026-09-03](performance/added-2026-09-03.md)

## Added 2026-09-03, closing the programme

<a id="an-incremental-transcript-projection"></a>
<a id="per-key-query-persistence"></a>
<a id="the-per-element-cost-in-the-terminal-client"></a>
<a id="the-numbers"></a>

[Added 2026-09-03, closing the programme](performance/added-2026-09-03.md#added-2026-09-03-closing-the-programme)

## 2026-09-02 — phase 0

<a id="the-renderers-startup-budget"></a>
<a id="the-icon-split"></a>
<a id="the-terminal-clients-eager-graph"></a>
<a id="the-nodes-boot-breakdown"></a>
<a id="the-desktops-cold-start-timeline--not-measured"></a>
<a id="what-the-histograms-said--not-measured"></a>

[2026-09-02 — phase 0](performance/added-2026-09-03.md#2026-09-02--phase-0)

## 2026-09-03 — phase 1

<a id="the-renderers-startup-budget"></a>
<a id="where-those-bytes-were-and-what-the-reads-got-wrong"></a>
<a id="the-editors-grammars"></a>
<a id="the-terminal-clients-eager-graph"></a>
<a id="what-the-four-tables-cost-one-line-each"></a>

[2026-09-03 — phase 1](performance/added-2026-09-03.md#2026-09-03--phase-1)

## 2026-09-03 — phase 2

<a id="the-boot-order-which-is-the-whole-phase"></a>
<a id="the-desktops-cold-start-timeline--measured-this-time"></a>
<a id="what-the-renderer-stopped-waiting-for"></a>
<a id="the-renderers-own-marks-and-the-one-that-would-not-be-read"></a>
<a id="not-measured-and-why"></a>

[2026-09-03 — phase 2](performance/2026-09-03--phase-2.md)

## 2026-09-03 — phase 3

<a id="the-449-ms-phase-2-could-not-see-split"></a>
<a id="what-the-293-ms-is-and-why-per-plugin-chunks-are-refused"></a>
<a id="the-boot-before-and-after"></a>
<a id="the-login-shell-probe-which-is-the-phases-real-number"></a>
<a id="what-the-concurrent-init-pass-actually-saved-nothing-measurable"></a>
<a id="the-ten-sqlite-opens-and-migrations-confirmed-a-non-issue"></a>
<a id="the-102-ms-nobody-was-looking-for"></a>
<a id="the-second-launch-writes-nothing-under-the-plugin-cache"></a>
<a id="not-measured"></a>

[2026-09-03 — phase 3](performance/2026-09-03--phase-2.md#2026-09-03--phase-3)

## 2026-09-03 — phase 4

<a id="first-draw"></a>
<a id="the-eager-closure-and-the-new-ceiling"></a>
<a id="the-cache-directory-is-written"></a>
<a id="two-things-the-reorder-exposed-both-fixed-here"></a>
<a id="not-measured"></a>

[2026-09-03 — phase 4](performance/2026-09-03--phase-2.md#2026-09-03--phase-4)

## 2026-09-03 — phase 5

<a id="git-processes-per-status-ping"></a>
<a id="the-worktree-removal-guard"></a>
<a id="sqlite-reads-in-auth"></a>
<a id="the-task-list-route"></a>
<a id="query-traffic-on-an-idle-client-while-a-terminal-streams--counted-at-the-client-not-the-node"></a>
<a id="backpressure"></a>
<a id="not-measured"></a>

[2026-09-03 — phase 5](performance/2026-09-03--phase-5.md)

## 2026-09-03 — phase 6

<a id="parser-work-for-an-unwatched-session"></a>
<a id="what-an-attach-costs-the-node"></a>
<a id="network-per-tab-switch"></a>
<a id="termout-wire-volume"></a>
<a id="not-measured"></a>

[2026-09-03 — phase 6](performance/2026-09-03--phase-5.md#2026-09-03--phase-6)

## 2026-09-03 — phase 7

<a id="the-event-mix-database-wide"></a>
<a id="what-one-streamed-event-costs"></a>
<a id="the-markdown-work-on-the-longest-fenced-message-in-the-database"></a>
<a id="the-snapshot-a-client-reads"></a>
<a id="what-a-projected-event-reads"></a>
<a id="not-measured"></a>

[2026-09-03 — phase 7](performance/2026-09-03--phase-5.md#2026-09-03--phase-7)

## 2026-09-03 — phase 8

<a id="list-re-renders-while-a-200-file-diff-hydrates"></a>
<a id="requests-when-the-editor-pane-comes-back"></a>
<a id="round-trips-to-first-editor-text-on-a-remembered-file"></a>
<a id="the-node-switch-remount-which-is-an-examination"></a>
<a id="rail-hover-prefetch"></a>
<a id="not-measured"></a>

[2026-09-03 — phase 8](performance/2026-09-03--phase-8.md)

## 2026-09-03 — phase 9, the terminal client's keystroke

<a id="what-a-key-press-walks"></a>
<a id="what-the-footer-costs"></a>
<a id="the-diff-pane-at-5000-lines"></a>
<a id="not-measured"></a>
<a id="re-read-against-the-painter-that-came-after"></a>

[2026-09-03 — phase 9, the terminal client's keystroke](performance/2026-09-03--phase-8.md#2026-09-03--phase-9-the-terminal-clients-keystroke)

## 2026-09-03 — phase 10, the re-measurement

<a id="the-build-artifacts-re-measured"></a>
<a id="the-nodes-boot-end-to-end-with-a-fresh-data-root"></a>
<a id="the-service-bundles-evaluation-351-ms-not-293-ms-and-the-difference-is-the-machine"></a>
<a id="the-request-log-and-the-histograms-read-for-the-first-time"></a>
<a id="the-transcript-projection-and-why-it-does-not-become-incremental"></a>
<a id="the-tree-hosts-remove-which-was-the-one-argument-the-numbers-took-up"></a>
<a id="the-persisted-query-cache-weighed-after-months-of-use"></a>
<a id="the-suites"></a>
<a id="what-is-still-not-measured-and-what-each-one-needs"></a>

[2026-09-03 — phase 10, the re-measurement](performance/2026-09-03--phase-10-the-re-measurement.md)

## 2026-09-11 — the node's async-local store


[2026-09-11 — the node's async-local store](performance/2026-09-03--phase-10-the-re-measurement.md#2026-09-11--the-nodes-async-local-store)
