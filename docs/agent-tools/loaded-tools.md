# Loaded tools and context sections

A loaded plugin doesn't get the live `ctx.tools` or `ctx.contextSections` registries. It declares
tools and context sections as data in `acorn-plugin.json`, and the host adapts them into the same
registries compiled plugins use. This page covers the manifest form, the request and response shapes,
and the limits. `packages/node-core/src/server/pluginHost/host.ts` registers them.

## Loaded manifest carriers

```json
{
  "contributions": {
    "agentTools": [{
      "id": "lookup",
      "description": "Read the package's task-local record.",
      "inputSchema": {
        "type": "object",
        "properties": { "id": { "type": "string", "minLength": 1, "maxLength": 100 } },
        "required": ["id"],
        "additionalProperties": false
      },
      "risk": "read",
      "scope": "task",
      "handler": "/v1/p/example/tools/lookup",
      "timeoutMs": 5000,
      "maxOutputBytes": 65536
    }],
    "contextSections": [{
      "id": "references",
      "label": "Example references",
      "scope": "task",
      "order": 60,
      "read": "/v1/p/example/context/references",
      "defaultIncluded": false,
      "timeoutMs": 5000,
      "maxBytes": 32768,
      "maxTokens": 4096
    }]
  }
}
```

Tool IDs are lowercase snake case and become `<pluginId>_<id>` in the registry. A context section
whose ID equals its plugin ID keeps the ID `<pluginId>`, and others become `<pluginId>:<id>`. Tool and
inclusion preferences are stored by these IDs, so renaming one drops the preference.

## Input schemas

The JSON Schema language is small: one object root, object, array, and scalar types, `properties`,
`required`, boolean `additionalProperties`, `items`, `enum`, string, number, and array limits, and
descriptions. `$ref`, remote or recursive schemas, combinators, executable validators, and unknown
keywords fail manifest validation. A schema is limited to 64 KiB, eight levels, 64 properties, and 64
enum values. The host compiles it once and validates arguments on every call.

## Tool handlers

The handler receives `POST { arguments, origin: { taskId, sessionId?, callId? } }`. The origin fields
are informational: the host builds the route's `PluginRequestContext.principal` from the verified task
or session token and the signed tool ceiling. The handler route must belong to the declaring plugin,
and the internal task principal can't use device-only routes. Your preferences, the session
requirement, the risk tier, and the signed ceiling all apply before dispatch. Output must be JSON
within the declared limit, 1 to 256 KiB. Timeouts run from 100 ms to 30 seconds and return the
ordinary `timeout` tool error.

The adapter doesn't retry a handler. The MCP loopback proxy can reconnect after a Node restart, and
keeps one `x-acorn-tool-call-id` for the logical call. A handler that writes uses that ID, or its own
key, for idempotency, because a lost reply isn't permission to repeat a write.

## Context reads

A context read receives `POST { origin: { taskId }, scope: "task" }` under a host-built task
principal, and returns this shape:

```json
{
  "items": [{
    "id": "record-1",
    "kind": "reference",
    "label": "Record one",
    "body": "Bounded reference text",
    "details": ["optional detail"],
    "sources": [{ "label": "origin", "uri": "urn:example:record-1" }]
  }],
  "compact": "## Example references\n- Record one",
  "omitted": 0,
  "unavailable": { "detail": "optional non-fatal status" }
}
```

The response is strict data, not a formatter. The assembler applies the section's byte and token
limits and the 512 KiB global budget, in `order` and then ID order. A timeout, HTTP failure, or an
oversized or invalid response marks that section unavailable, as `timeout`, `unavailable`, or
`invalid-response`, and keeps its siblings. `defaultIncluded` sets only the first inclusion, and your
include list wins after that. The returned text is reference data, not instructions to the host.

## Reload

A reload first removes the old registrations, then registers the new set. A failed reload restores
the previous set, so an update or unload can't leave a stale tool or section.

## Why the tracker tools stay in core

A loaded tool's handler must be one of its own plugin's routes, so it reaches one package and one
connection. `issue_detail` and its siblings search every connected provider under one name, so core
owns them even though Linear and Rollbar can declare loaded tools ([tracker tools](./tracker-tools.md)).
