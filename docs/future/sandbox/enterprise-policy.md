# Enterprise policy: acorn as the control plane

Part of [docs/future/sandbox/](./README.md). This is the opt-in governance layer: a company sets the
rules, and the person at the keyboard can only tighten them, never loosen. It sits on top of the API
gates ([api-gates.md](./api-gates.md)) and the sandbox ([sandbox.md](./sandbox.md)); neither is
sufficient for a buyer without it, and it is worthless without them.

## The one rule that decides whether this is real

Configuration merges **most-restrictive-wins**, not last-writer-wins. Today acorn has three
configuration layers — device prefs, the project row, and `node.json`. Enterprise needs a fourth
above all three: a managed layer delivered to a protected path by MDM, that a local write can only
narrow. Get this merge direction right and everything else hangs off it. Get it wrong and the whole
layer is theatre, because a developer edits a file and the policy evaporates.

This is small, and it goes first within this file, because every control below is expressed as a
managed-layer value and inherits this merge.

## The rule that protects the solo developer

**With no managed layer present, the resolver never runs.** Absent, not defaulting-to-permissive. A
solo developer who never enrolls pays nothing: the resolver short-circuits before it executes, so a
bug in the policy engine cannot degrade a day for someone who never turned it on. This is the
non-negotiable from [README.md](./README.md) § What must not regress, restated as an implementation
constraint: the first branch of the resolver is "is a managed layer present? if not, return the
un-governed path unchanged."

## The policy vocabulary

Name this early and get it right, because every layer inherits the words. A managed policy expresses:

- **Execution target.** `host` allowed, or sandbox required. Ties to [sandbox.md](./sandbox.md).
- **Egress.** The allowed-host set for a task's sandbox network policy.
- **Filesystem.** Beyond the worktree mount, what a sandbox may read. Default: nothing.
- **Tool tiers.** A ceiling on `agentTools.perms` that a local pref can only lower, never raise. The
  registry already applies a ceiling that can only narrow (`docs/agent-tools.md` § Projections); the
  managed layer supplies the ceiling instead of the local pref.
- **Model allowlist.** Which providers and models a task may use.
- **MCP servers.** The allowed set, delivered rather than discovered.
- **Telemetry sink.** The OTLP endpoint audit is exported to (see § Audit below).

Do not build a policy language. Ten vendors sell one, and a home-grown engine becomes a worse OPA to
maintain forever. This vocabulary is a fixed struct with a most-restrictive merge, nothing more.

## Trust the row

The repo-config trust gate (`packages/node-core/src/server/repoConfigTrust.ts`) hashes `.acorn/*` files
on the premise that the checkout is untrusted and the database is trusted. [api-gates.md](./api-gates.md)
§ Gate 2 closes the write path that broke that premise. As the belt behind that gate, extend
`readRepoConfigSnapshot` to include the project row's executable fields (`setupScript`, `devScript`,
`teardownScript`, `dbUrlScript`) in the snapshot it hashes. Then the doc's claim becomes "repo config
and the project row are the untrusted input," which is true once both are writable by something the
owner did not type.

## Audit must leave the box

`docs/security.md` § Audit is honest that the trail is not tamper-evident against someone who controls
the database file — and a developer controls the database file. For a buyer, the audit has to leave
the machine. Two pieces:

1. **OTLP export** of the existing append-only `audit` table
   (`packages/node-core/src/server/routes/security/audit.ts`, retention and route already exist) to the managed
   telemetry sink.
2. **The tool-dispatch trail.** `docs/agent-tools.md` § Rich results already names the registry
   dispatch seam as where a tool-usage audit belongs. Emit it there, keyed by task, and export it the
   same way.

Retention, the read route, and the dispatch seam all exist. This is mostly plumbing, not new design.

## The plugin containment rung

This is the question a security review actually asks: what stops a loaded plugin's node half from
reading `core.sqlite`? Rung 2 (`docs/security.md` § Rung 2) now answers it. Each node half runs in
its own permission-scoped worker, reaches the host through an owner-bound, manifest-shaped RPC
context, and receives only exact filesystem grants. Loader acceptance tests prove that direct
`node:sqlite` access cannot open core or peer databases.

A managed policy therefore has no weaker in-process mode to disable: if the isolated realm cannot
start, the plugin does not load. Rung 3 remains the separate question of OS-adversarial confinement,
crash isolation, and per-plugin resource controls.

## What acorn does not build

No gateway, no DLP, no PII scanner, no guardrails, no policy engine. acorn's job is three settings:
egress goes through this network policy, telemetry goes to this OTLP endpoint, MCP servers come from
this allowed set. Route to what the enterprise already bought (see [research.md](./research.md) for
the market). The differentiator is task-scoped policy, not a reimplementation of Kong.

## Why a buyer can be shown this before the sandbox exists

Build the managed layer and a resolved-policy view before the sandbox integration. A buyer evaluates
"show me what this task is allowed to do and who decided," and that demo works with the execution
target still set to `host`. It also forces the vocabulary above to be named early, when it is cheap to
change. That is why [phases.md](./phases.md) places the managed tier before the sandbox wiring even
though the sandbox is the bigger security win.
