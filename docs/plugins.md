# Plugin architecture

> **Removed.** The bearer-authenticated public automation API (`/api/v1`), its tokens,
> idempotency store and second listener were deleted in vNext Phase 0 — along with
> `oauth_accounts`, `api_tokens`, `api_idempotency` and `command_executions`. Passages below
> that describe it are historical. See [vNext/plan.md](./vNext/plan.md).

acorn is organised into three layers under `apps/desktop/src`:

- `core/` owns platform contracts and services: the shell, persistence, registries, HTTP/auth,
  SQLite, transport, worktree primitives, MCP projection, and shared wire types.
- `plugins/<name>/` owns a product feature and may contain `client`, `server`, `main`, `mcp`, or
  `shared` parts.
- `app/` is the composition layer. It activates the built-in plugins and is the only layer that
  chooses the concrete shipped feature set.

This is a statically composed in-tree plugin system, not a runtime package loader. A contribution is
registered at startup, then consumed through a core registry or an injected capability.

## Runtime boundaries

Client code runs in the sandboxed renderer. Server and most legacy-named `main` modules run in the
Node utility service; MCP code runs in the stdio proxy. The small Electron `app/main` graph owns
native UI adapters and service supervision. Renderer modules must not import
server/main/service/MCP implementations, Node-side modules must not import renderer components, and
the utility-service graph must remain Electron-free. Shared modules contain serializable contracts only.

Folder names describe the original architecture, not necessarily the current process. In particular,
the service runtime still imports Electron-free wiring from `app/main/*Wiring.ts` and domain engines
from `core/main` and `plugins/*/main`. Treat those as service-owned unless their dependency graph
imports Electron. New native adapters belong in the main graph; new domain engines belong in the
service graph.

`apps/desktop/tools/arch/boundaries.test.ts` enforces those runtime boundaries and prevents
`core/`/`plugins/` from importing the `app/` composition layer. It also records a shrinking baseline
of legacy core→plugin and plugin→plugin imports; new cross-feature edges fail the test, and removing
an edge requires removing its baseline entry.

## Contribution points

| Surface | Registry or contract | Activation home |
| --- | --- | --- |
| Panes | `@acorn/client-core/registries/panes.ts` | each plugin's `client/index.ts` (`ctx.panes`) |
| Sources | `@acorn/client-core/registries/sources.ts` | each plugin's `client/index.ts` (`ctx.sources`) |
| Commands / keybindings | `@acorn/client-core/registries/{commands,keybindings}.tsx` | the component that owns them, at MOUNT — a pane's shortcuts exist only while it does |
| Settings pages | `@acorn/client-core/registries/settings.ts` | `ctx.settingsPages`; core's own in `app/client/pageContributions.tsx` |
| UI slots, task slots, agent contexts, agent tool renderers, pollers, persisted state | `@acorn/client-core/registries/` | `ctx.{slots,taskSlots,agentContexts,agentToolRenderers,pollers,persistedState}`; core's own in `app/client/{slotContributions,activate}.ts` |
| Notices, themes, styles | `@acorn/client-core/registries/` | core-owned; no plugin contributes one, so they are not on `ClientPluginContext` |
| HTTP routes (internal) | `@acorn/node-core/server/routeRegistry.ts` | `app/server/routes.ts` |
| Public API endpoints | `@acorn/node-core/server/publicApi/` (schema-first `PluginApiContribution`) | `app/server/publicApi.ts` |
| Provider connections | `@acorn/node-core/server/integrations/connectionRegistry.ts` | `app/server/providers.ts` |
| External-item integrations | `@acorn/node-core/server/integrations/registry.ts` | `app/server/providers.ts` |
| Model generation adapters | `@acorn/node-core/server/modelProviders/registry.ts` | `app/server/providers.ts` |
| Agent tools and context | `@acorn/node-core/server/agentTools/` | service runtime imports `app/main/{agentToolsWiring,contextSectionsWiring}.ts` |
| Agent profiles | `@acorn/node-core/main/agentProfiles/` | service runtime imports `app/main/agentProfiles.ts` |
| Workflow steps, policies, triggers | `plugins/workflows/main/workflowRegistry.ts` | service runtime imports `app/main/workflowWiring.ts` |

Registries reject duplicate identifiers. Server route contributions must stay under `/api`, where
the core app applies CSRF, principal resolution, and `requireUser` before mounting contributed
routers. Service-process implementations are injected before the listener accepts requests, so a
route either has its capability or returns the standard `bridge-unavailable` error.

A plugin may also contribute to the opt-in public automation API: a schema-first
`PluginApiContribution` mounted under `/api/v1/plugins/<pluginId>`, whose Zod schemas are validated at
runtime and generate OpenAPI. The registry `freeze()` enforces namespace, scope, and strict-schema
invariants, so a malformed contribution cannot mount. See `plugins/<name>/server/publicApi.ts`.

## Adding a feature

1. Put feature-owned UI, routes, Node services, native adapters, and contracts under one
   `plugins/<feature>/` directory, split by runtime.
2. Expose behavior through the narrowest existing contribution point. Add a new registry only when
   the behavior is genuinely open-ended and has more than one plausible contributor.
3. Register the concrete contribution in `app/`; do not make `core/` discover product modules.
4. Keep request/response work on authenticated HTTP, streams on the shared WebSocket, and preload
   IPC for renderer-facing Electron-native capabilities only. If a service-owned feature needs a
   native operation, add a narrow serializable contract to the service protocol rather than
   importing Electron into the engine.
5. Add focused behavior tests plus any registry, route, provider, or architecture conformance case.
6. Update the durable topic documentation in the same change.

For agent tools see [agent-tools.md](./agent-tools.md); for providers see
[integrations.md](./integrations.md); for state ownership see [state.md](./state.md).
