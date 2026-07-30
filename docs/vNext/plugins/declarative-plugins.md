# Declarative plugins

Status: Normative<br>
Requirement prefix: `PLUG-DECL`

A declarative plugin has no executable Node or client code. It composes declared queries, commands,
events, semantic views, settings, setup and schedules from core or dependency capabilities.

- **PLUG-DECL-001:** Declarative documents MUST validate against signed local schemas before
  activation and before every patch/action crosses the host boundary.
- **PLUG-DECL-002:** The expression language is a typed bounded AST supporting literal values,
  property lookup, equality/order, boolean logic, null coalescing, bounded map/filter/sort, string
  formatting, date/number formatting and localization lookup. It has no evaluation, reflection,
  dynamic property construction, recursion, unbounded iteration, regular-expression execution,
  I/O, time, randomness or global state.
- **PLUG-DECL-003:** Every data source MUST reference a manifest-declared query or subscription,
  provide an input mapping and output schema, and declare cache/stale/error policy. Inline URLs and
  SQL are invalid.
- **PLUG-DECL-004:** Every action MUST reference a manifest-declared command, navigation intent or
  view-session operation. It MUST state confirmation policy, optimistic patch, rollback patch and
  result handling where applicable.
- **PLUG-DECL-005:** Declarative views MUST use the
  [semantic renderer catalog](../ui/renderers/README.md). Raw HTML, SVG markup, JavaScript,
  stylesheets, inline styles, arbitrary class names and browser APIs are prohibited.
- **PLUG-DECL-006:** The host MUST enforce view document limits: 1 MiB encoded document, 2,000
  nodes, depth 32, 2,000 collection rows per page, 256 bindings, and 128 active actions. Lower
  renderer-specific bounds may apply.
- **PLUG-DECL-007:** A declarative plugin cannot directly access secrets. It may call a broker
  capability that injects an authorized secret for an exact purpose and returns a redacted result.
- **PLUG-DECL-008:** Declarative background work is limited to declared Node pollers and event
  subscriptions. The scheduler enforces minimum intervals, runtime deadlines, concurrency and
  backoff.
- **PLUG-DECL-009:** Failure of one expression, binding, data source, action or component MUST
  produce a bounded host-rendered error at the nearest safe boundary and count toward installation
  health.
- **PLUG-DECL-010:** Host output encoding is renderer-owned. User/provider/plugin strings are text,
  never markup, unless the renderer consumes a separately sanitized format such as CommonMark.
- **PLUG-DECL-011:** Declarative plugins MUST work headlessly for Node-only commands and schedules.
  A UI contribution cannot be the only way to complete a required recovery action.
- **PLUG-DECL-012:** Contract tests MUST cover malformed expressions, oversized documents, cyclic
  bindings, unauthorized actions, stale versions, patch failure, localization absence and renderer
  fallback.
