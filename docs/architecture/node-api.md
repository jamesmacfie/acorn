# Node API and client flow

This page describes how a client reaches a Node: the route families, the renderer's single door to
its host, and where the Node validates what it receives. Read it before you add a route or change how
the renderer talks to a Node. [API reference](../api-reference.md) lists the routes, errors, and
transport in detail.

## Route families

The Node runs one Hono application:

| Path | Holds |
| --- | --- |
| `/v1/node` and `/v1/pair` | The two pre-auth pairing routes. |
| `/v1/core/*` | Core-owned workspaces, projects, tasks, worktrees, integrations, settings, security, backup, audit, schedules, agent tools, and task context. |
| `/v1/p/<plugin>/*` | Plugin routes. A compiled plugin's router is mounted when the app is built. A loaded plugin's handler is looked up per request, so a plugin reloaded in place serves its new handler without a restart. |
| `/v1/events` | The authenticated WebSocket for invalidation events, PTY and process streams, Docker streams, workflow notices, agent events, and preview tunnels. |

A plugin owns its own wire surface. Its route builders, request and response types, and query keys
live in its `shared/` folder, or in `contract/` when another plugin reads them. Copy
`plugins/docker/src/shared/model.ts`. Protocol may declare no `/v1/p/` route, and
[package boundaries](./packages.md#protocol-owns-no-plugins-wire-surface) lists the other rules. A
plugin can define its wire contract without editing core, which third-party plugins depend on.

Every response has an `X-Request-Id`. Errors use one envelope:
`{ error: { code, message, requestId, retryable, details? } }`. Mutations may send an
`Idempotency-Key`. Session creation, agent turns, and request resolution require one.

## The platform seam

The renderer reaches its host through one folder, `packages/client-core/src/infra/platform/`. It
groups what a host provides into separate nullable capabilities: Node transport, fleet membership,
plugin custody, and native extras. The client's API layer calls the transport group. No other client
file may read the injected `window.acorn` global, and `tools/arch/boundaries.test.ts` fails any file
outside the folder that does. The desktop bridge implements every group. A web client would implement
transport and leave out the desktop extras.

The helper supplies the Node endpoint, the pinned HTTPS agent, and the bearer token. The renderer
never holds a token or certificate, and the app's CSP stops it from opening a direct network
connection.

## Wire validation

A route that accepts a body parses it with a Zod schema and returns 400 on failure. Use `safeParse`
against a module-level schema, as `packages/node-core/src/server/routes/projects/worktree.ts` does.
Reads aren't validated, because the client is TypeScript compiled against the same types, and a
response schema would repeat the type.

Hand-written `typeof` chains were where the bugs hid: a positive-integer check spread over three
conditions, or a non-empty string check that only tested `typeof`. `tsc` can't see either, because
the body starts as `unknown`. So the rule is an architecture test. A file that calls `c.req.json()`
and has no `safeParse` fails `tools/arch/boundaries.test.ts`. The check is per file, which is coarse
on purpose: the failure worth catching is a route file with no schema at all.

One allowlist entry remains: the usage routes in `plugins/agents`. Their validators live in `shared/`
so the settings form can run them too and show a message per field. The test names the reason and
fails if that file stops reading a body.

acorn doesn't generate response schemas, request and response code, or an OpenAPI document. Every
consumer is TypeScript in this repository, so Zod at the boundary is enough.

### Untrusted answers

The exception is an answer from a loaded plugin. It isn't this repository's TypeScript, and the host
draws it under its own chrome. Those reads get real schemas in `@acorn/protocol` and are parsed on
arrival:

- The manifest.
- Agent context options and snapshots.
- Batch reference resolutions.
- Typed data sources, whose rows the host draws as its own table. See [dashboards](../dashboards.md).

Each parses all or nothing instead of cleaning field by field, because a half-accepted answer looks
complete and isn't. To add to this list, make the same argument: the wire is untrusted, and the host
draws the result.

## Dependency security floors

Runtime dependency security floors live in the root `package.json` overrides. The standalone packer
carries them into npm's manifest, and `tools/arch/dependencySecurity.test.ts` checks that pnpm's
runtime overrides agree. [Node distribution](../node-distribution.md#dependency-security-policy)
covers direct dependency references and the limits of a reproducible standalone install.
