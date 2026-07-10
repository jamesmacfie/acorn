# Agent tools

Every agent capability — read the task context, read/write notes, search/propose memory, read git,
drive the preview browser, control run targets — is declared **once** as an `AgentToolContribution`
and **projected** to each surface that needs it. The registry
(`apps/desktop/src/core/server/agentTools/registry.ts`) is the single source of truth for a tool's name,
description, input schema, risk tier, availability and handler. Adding a tool is one contribution
object, not edits spread across MCP code, a harness route, preload and settings.

> This replaced the old hand-synced ladder (an MCP `registerTool` body ↔ a bespoke harness route ↔ a
> per-domain bridge). If you are looking for how the MCP server is launched and inspected, see
> [mcp.md](./mcp.md); this doc is the tool *catalog and contract*.

## 1. The contribution

```ts
type AgentToolContribution = {
  name: string
  description: string
  input: z.ZodType
  scope: 'task'
  risk: 'read' | 'write' | 'execute'
  exposeToRenderer?: boolean
  when?: (ctx) => boolean | Promise<boolean>
  whenDescription?: string
  handler: (args, ctx) => Promise<unknown>
}
```

A handler returns **domain data or throws a `ToolError`** (`not_found` / `bad_request` / `failed`).
It never knows which surface invoked it — if a handler inspects the caller's surface, the boundary is
wrong. `ctx` carries only invocation-scoped identity (`taskId`, resolved `userLogin`, and the agent
`sessionId` used to stamp write provenance); every domain dependency is closed over when the
registry is built in the main process (`apps/desktop/src/app/main/agentToolsWiring.ts`).

## 2. Projections

The contribution is projected to three surfaces plus a permission filter:

| Projection | Where | How |
| --- | --- | --- |
| **MCP** | `apps/desktop/src/core/mcp/server.ts` | The MCP process is a generic proxy: it fetches `GET /api/tasks/:id/tools` (the manifest) and serves `tools/list`, then proxies each `tools/call` to `POST /api/tasks/:id/tools/:name`. It holds no tool definitions. |
| **Harness HTTP** | `apps/desktop/src/core/server/routes/agentTools.ts` | `GET /:id/tools` and `POST /:id/tools/:name` require the internal principal. Schemas use the MCP SDK's draft-07 projection; calls validate with the contribution's Zod schema. |
| **Renderer** | `POST /:id/renderer-tools/:name` | Cookie-authenticated, and returns `404` unless the contribution opts in with `exposeToRenderer`. `client/agentToolsClient.ts` is the thin client. |
| **Permissions** | prefs slice + `isToolPermitted` | Applied uniformly by every projection (below). |

**Dynamic availability** re-evaluates on every manifest read. `when` gates a tool per task (the
`run_*` tools only appear once a repo has run targets), and the MCP server polls the manifest and
emits `notifications/tools/list_changed` when the available set changes — so `run_*` appear
mid-session without a restart.

## 3. Risk tiers and permissions

Every tool declares a risk tier:

- **read** — inspect context, notes, memory, git, the PR. No side effects.
- **write** — create/edit notes, **propose** memory (proposals stay human-gated).
- **execute** — drive the preview browser, control run targets in the worktree.

**Settings → Agent tools** (`AgentToolsSettings.tsx`) lists every tool grouped by tier with per-tier
and per-tool toggles, persisted as ONE prefs slice under `agentTools.perms`
(`{ tiers?, tools? }`; a per-tool toggle wins over its tier, both default on). Read has no master
toggle and is narrowed only per tool; write/execute have tier masters with mixed state. The filter is
consulted by every projection: turning a tier or tool off removes it from `tools/list` **and** makes
a direct harness call `404` (a hidden tool is *gone*, not forbidden — the surface must not leak that
it exists). Workflow/profile ceilings now ride the same manifest/call projection: a headless MCP
process sends its encoded run/step `allow`/`maxRisk` cap, and the route intersects it with these
global preferences. Either filter can remove a tool; a workflow can never re-enable one the user
disabled.

## 4. Context sections

`task_context` (and the push-path context block and the context pane) all derive from ONE section
registry, `apps/desktop/src/core/server/agentTools/contextSections.ts`. Each section (`pr`, `issues`,
`notes`, `memory`) declares its label, default, enforced budget, assembler, compact formatter and
optional jump. The serialized `TaskContext.sections` drives both the renderer tray and
`formatContextBlock`, so neither keeps an id-specific switch. Product semantics live in one place:

- **memory is index-only** by default (name + description; bodies via `memory_get`);
- **notes merge task → workspace → global**, carry bodies/slugs, and declare Notes-pane jumps;
- **linked provider items use the stale-safe cache**, with missing rows explicitly marked;
- budgets are applied before both compatibility fields and serialized items leave the server.

## 5. Invariants

- **`memory_write` proposes only.** No tool, plugin or provider writes accepted memory. Accepted
  memory stays human-gated and file-backed — the `memory_write` handler calls the proposal store, and
  the human review gate is the sole writer. See [memory.md](./next/memory.md), [notes-and-memory.md](./notes-and-memory.md).
- **Notes provenance is single-sourced.** Agent writes stamp `author: agent` + the agent session id
  through the same location-aware `NotesStore` the UI writes through. Agent writes default to
  `notes/task/<taskId>/`; callers can explicitly choose workspace/global scope.
- **Tools never touch GitHub or open their own DB.** They run in-process against the same local mirror
  the UI reads, so an agent sees exactly what the UI sees, and the internal principal has an empty
  GitHub token (see [mcp.md](./mcp.md) §2).

## 6. Adding a tool

Add one `AgentToolContribution` to the array in `apps/desktop/src/app/main/agentToolsWiring.ts` (close
over whatever dep it needs). It appears in the MCP manifest, the harness route, the permissions page
and the catalog automatically. No other file changes.

## Source

- Registry + permission filter: `apps/desktop/src/core/server/agentTools/registry.ts`
- Contributions (handlers, deps): `apps/desktop/src/app/main/agentToolsWiring.ts`
- Harness HTTP projection: `apps/desktop/src/core/server/routes/agentTools.ts`
- Thin renderer client: `apps/desktop/src/core/client/agentToolsClient.ts`
- MCP projection: `apps/desktop/src/core/mcp/server.ts` (client: `src/core/mcp/api.ts`)
- Context sections: `apps/desktop/src/core/server/agentTools/contextSections.ts`, wired by `apps/desktop/src/app/main/contextSectionsWiring.ts`
- Permissions UI: `apps/desktop/src/core/client/settings/AgentToolsSettings.tsx`

See also: [mcp.md](./mcp.md) · [notes-and-memory.md](./notes-and-memory.md) ·
[api-reference.md](./api-reference.md)
