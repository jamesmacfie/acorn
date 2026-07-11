# Plugin architecture

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

Client code runs in the sandboxed renderer. Server, main, and MCP code run with Node capabilities.
Renderer modules must not import server/main/MCP implementations, and Node-side modules must not
import renderer components. Shared modules contain serializable contracts only.

`apps/desktop/src/core/boundaries.test.ts` enforces those runtime boundaries and prevents
`core/`/`plugins/` from importing the `app/` composition layer. It also records a shrinking baseline
of legacy core→plugin and plugin→plugin imports; new cross-feature edges fail the test, and removing
an edge requires removing its baseline entry.

## Contribution points

| Surface | Registry or contract | Activation home |
| --- | --- | --- |
| Panes | `core/client/registries/panes.ts` | `app/client/taskPaneContributions.tsx` and feature pane modules |
| Sources | `core/client/registries/sources.ts` | `app/client/providerContributions.tsx` |
| Commands / keybindings | `core/client/registries/{commands,keybindings}.tsx` | `app/client/activate.ts` |
| Settings pages | `core/client/registries/settings.ts` | `app/client/pageContributions.tsx` |
| UI slots, notices, pollers, themes | `core/client/registries/` | `app/client/activate.ts` |
| HTTP routes (internal) | `core/server/routeRegistry.ts` | `app/server/routes.ts` |
| Public API endpoints | `core/server/publicApi/` (schema-first `PluginApiContribution`) | `app/server/publicApi.ts` |
| Integration providers | `core/server/integrations/registry.ts` | `app/server/providers.ts` |
| Agent tools and context | `core/server/agentTools/` | `app/main/{agentToolsWiring,contextSectionsWiring}.ts` |
| Agent profiles | `core/main/agentProfiles/` | `app/main/agentProfiles.ts` |
| Workflow steps, policies, triggers | `plugins/workflows/main/workflowRegistry.ts` | `app/main/workflowWiring.ts` |

Registries reject duplicate identifiers. Server route contributions must stay under `/api`, where
the core app applies CSRF, principal resolution, and `requireUser` before mounting contributed
routers. Main-process services are injected before the listener accepts requests, so a route either
has its capability or returns the standard `bridge-unavailable` error.

A plugin may also contribute to the opt-in [public automation API](./public-api.md): a schema-first
`PluginApiContribution` mounted under `/api/v1/plugins/<pluginId>`, whose Zod schemas are validated at
runtime and generate OpenAPI. The registry `freeze()` enforces namespace, scope, and strict-schema
invariants, so a malformed contribution cannot mount. See `plugins/<name>/server/publicApi.ts`.

## Adding a feature

1. Put feature-owned UI, routes, main-process services, and contracts under one
   `plugins/<feature>/` directory, split by runtime.
2. Expose behavior through the narrowest existing contribution point. Add a new registry only when
   the behavior is genuinely open-ended and has more than one plausible contributor.
3. Register the concrete contribution in `app/`; do not make `core/` discover product modules.
4. Keep request/response work on authenticated HTTP, streams on the shared WebSocket, and preload
   IPC for Electron-native capabilities only.
5. Add focused behavior tests plus any registry, route, provider, or architecture conformance case.
6. Update the durable topic documentation in the same change.

For agent tools see [agent-tools.md](./agent-tools.md); for providers see
[integrations.md](./integrations.md); for state ownership see [state.md](./state.md).
