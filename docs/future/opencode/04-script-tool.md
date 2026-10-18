# Phase 4: Add the run_script tool

Date: October 16, 2026. Status: proposed. Needs phases 1 and 3.

This phase adds one agent tool, `run_script`, which runs a short program that calls other Acorn
tools and returns one result. Read it before you build the tool.

## Why

An agent pays one model round trip per tool call. Asking "which of my five child sessions failed,
and what did each say last" takes five or more calls today. Each one pays a round trip, and each
result lands whole in the agent's context. With a script, the agent writes:

```js
const sessions = await tools.agent_session_list({})
const failed = sessions.sessions.filter((s) => s.status === 'failed')
return await Promise.all(failed.map((s) => tools.agent_read({ sessionId: s.id })))
```

That's one call and one result, holding only what the agent asked for. OpenCode calls this Code
Mode (`references/opencode/packages/codemode/README.md`). Cloudflare described the idea first.

## Decision

Phase 3 chose QuickJS on October 19, 2026: `quickjs-emscripten-core` with the
`@jitl/quickjs-wasmfile-release-sync` build, both pinned at exactly 0.32.0. It's the only candidate
that caps a program's memory. `@opencode/codemode` 2.0.29 has no memory limit, and its programs run
in the Node's own heap.

### Measurements

All taken on October 19, 2026, on an M-series Mac with Node 26.8.1. The proofs of concept lived in a
scratch folder outside the repo and were deleted. Bundle sizes come from Vite 8.0.16 with the Node
build's settings: SSR output, `node22` target, oxc minify.

| Check | `@opencode/codemode` 2.0.29 | QuickJS 0.32.0, sync build |
| --- | --- | --- |
| Bundled JavaScript | 357,973 bytes in one chunk. The `acorn` parser is 115,534 of it, and most of the rest is Effect 4.0.1. | 51,542 bytes in four chunks. |
| Other files | None. | One 503,134-byte `.wasm` file. Vite doesn't copy it, so a bundled build fails to load until the file sits beside the chunk. |
| Cold start, `return 1` | 11.3 ms, with Effect already imported. | 7.9 ms for a fresh runtime, plus 5.1 ms once per process to load the wasm module. |
| Warm `return 1`, median of 200 | 0.21 ms. | 0.17 ms, with a fresh runtime each run. |
| Two async host calls in `Promise.all` | Pass. Two 50 ms calls took 55 ms. | Pass, through `newPromise` and a loop that runs pending jobs. Two 50 ms calls took 56 ms. The asyncify build isn't needed. |
| Busy loop at a 1 s limit | Stopped at 1,001 ms with `TimeoutExceeded`. | Stopped at 1,001 ms with `InternalError: interrupted`. |
| Memory | No limit. One program took 540 MB of the host's heap in 8 seconds and finished. In a worker thread with a 64 MB heap cap, it slowed to a crawl instead of failing, and reported a timeout after 38 seconds. | `setMemoryLimit(32 MiB)` stopped a growing array after 280 ms with `InternalError: out of memory`. The Node's heap was untouched. |
| `globalThis.process`, `require`, `fetch` | Unknown identifier. Even `globalThis` is unknown. | `undefined`. |
| `import()` | Unsupported syntax. | Fails: "could not load module". No module loader is installed. |
| `Function('return this')()` and `eval` | Refused. | Run, but reach only QuickJS's own global object: the standard built-ins and `tools`. |
| A host object's prototype chain | `constructor` reads as `null`. Writing through `__proto__` changed nothing on the host. | Values cross as JSON copies, so no host object enters the engine. |
| Syntax error | `ParseError`, "Unexpected token (2:10)". The line is in the message only, not in `location`. | `SyntaxError` with `lineNumber` and a `script.js:3:11` stack. |
| Thrown `Error` | "Error: boom", with no line. | Message plus a stack with line and column for each frame. |

Both line numbers above run one line high in QuickJS, because the proof of concept wrapped the
program in an async function on a line of its own.

Dropping Effect from codemode isn't a day's work. Effect is the interpreter's evaluation engine:
`interpreter.ts` alone has 160 `yield*` steps and 269 Effect calls, and timeouts, interruption, and
`Promise.all` all run on Effect fibers. Removing it means rewriting the security boundary. Effect 4
left beta after phase 3 was written: 4.0.5 is its latest release.

Codemode also runs a restricted language. Classes, getters, and setters fail as unsupported syntax,
so ordinary JavaScript an agent writes can fail for reasons QuickJS never has.

### What it costs the size budget

The budget counts `dist/service.js` and every chunk it reaches through static imports. At this
branch's base, `558cf74c6`, the build measured 1,884,673 bytes against a ceiling of 1,884,400. So
it was 273 bytes over before any interpreter. Phase 1's `toolOutput.ts` sits on that graph,
through `packages/plugin-api/src/node.ts`.

- QuickJS loaded with `await import()` costs 0 bytes against the budget. Imported statically, it
  costs 51,542 bytes. The wasm file never counts, because it isn't a chunk.
- Codemode loaded lazily also costs 0 bytes. Imported statically, it costs 357,973 bytes.
- Either way, the bundle on disk grows: 554,676 bytes for QuickJS and 357,973 for codemode. The
  Node's `dist` was 16,416,086 bytes.

### What this phase must do

- Load the interpreter on first use. Keep the tool's registration in `coreTools.ts` small, and put
  the handler in its own module that the registration loads with `await import()`. That module is
  the only one that imports QuickJS. Even the registration adds bytes to a graph that's already
  over the ceiling, so this phase has to find room or justify a raise in its commit message.
- Add `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync` to
  `requiredRuntimePackages` in `scripts/nodeRuntimePackages.ts`. Desktop staging and standalone
  packaging then install them beside the bundle, and the loader finds its wasm file next to its own
  code. Bundling them instead means copying the wasm file in the build and passing its path through
  `newVariant`.
- Make a fresh runtime and context for every program, and dispose of both in a `finally` block.
  Load the wasm module once per process.
- Pass values across as JSON strings in both directions. Never give the engine a handle to a host
  object or function other than the `tools` functions.
- Enforce the time limit on both sides. `setInterruptHandler` stops only running JavaScript. While a
  program awaits a host call, the host must stop waiting at the deadline and abort the call.
- Report errors as `name: message` with the line from the stack. Wrap the program so its first line
  stays line 1, or subtract the wrapper's lines.

### Limits to set

- Time: 120 seconds in total, as below. The interrupt handler and the host's wait both use one
  deadline.
- Memory: 32 MiB per program, set with `setMemoryLimit`. It held 50 parsed results of 380 KiB
  each. Also set `setMaxStackSize` to 512 KiB, so deep recursion fails as an error.
- Calls: 50. The host function counts them and throws past the limit, so the program sees a thrown
  error, as it does for any refused call.

All programs share the one wasm module's memory, which can grow to 2 GiB and never shrinks. At
32 MiB each, about 60 programs can run at once before it fills. Cap concurrent scripts if that
matters.

## The tool

Register `run_script` as a core agent tool beside the others in
`packages/node-core/src/server/agentTools/coreTools.ts`:

- Input: `{ code: string }`, at most 20 KB.
- Risk: `read`. The script tool itself reads nothing. Each call the program makes is checked
  against that tool's own risk, as described below.
- Description: say that `tools.<name>(input)` calls any Acorn tool listed in this session with the
  same input it takes directly, that the last expression or a `return` is the result, and what the
  limits are. Don't repeat each tool's schema. The agent already has the tool list.

The result is `{ ok, value, logs, calls }`. `calls` lists each tool call the program made, by name
and outcome, so a transcript card can show what ran. On failure, `ok` is `false` and `error` gives
the message and line number. Phase 1's cap applies to the whole result.

## Every inner call passes the same gates

This rule matters more than anything else in the phase. A call from inside a script must pass every
check a direct call passes, in the same order:

1. The tool exists, and the caller's principal may see it.
2. `requiresSession`, the permission tier and the per-tool switch, and the workflow ceiling.
3. The tool's `when` availability.
4. Input validation against the tool's schema.
5. The `core:before-tool-call` hook.
6. The provenance proof for tools that need a signed session.
7. The `tool.call` span.

All of this lives in `invoke` in `packages/node-core/src/server/routes/plugins/agentTools.ts`, tied
to the Hono request. Pull the checks after authentication into one function that takes the
principal's facts and a `ToolContext`. Have `invoke` and `run_script` both call it. Don't write a
second copy of any check.

`run_script` can't call itself. The program sees `tools.run_script` as missing.

Each inner call gets the call ID `<outer call ID>:<n>`, numbered from 1 in the order the program
starts them. A retried outer call then repeats the same inner IDs, and handlers that rely on the
ID for idempotency stay correct.

## Limits

Take the numbers from the [decision](#limits-to-set). Start from these and change them only with a
reason:

- 120 seconds in total, because `agent_wait` and `task_scripts_wait` can block.
- 50 tool calls.
- 32 MiB of interpreter memory.
- Logs from `console.log`, capped with the result.

When the outer call is cancelled, cancel the program and every inner call through the same
`AbortSignal`.

## The transcript

Add a tool card for `run_script` that shows the program, collapsed, and the list from `calls`. A
person reviewing the session should see which tools ran without opening the raw result.

## Tests

- Through the real `createApp()` route and the MCP projection, as [agent tools](../../agent-tools.md)
  asks for every tool.
- A program that calls a tool switched off in permissions gets that call refused, and the program
  sees a thrown error.
- A workflow step session with a read-only ceiling can't make a write call through a script.
- A `core:before-tool-call` veto stops an inner call.
- Every escape attempt from phase 3 fails through the real tool.
- A program over the time limit or the call limit stops with a clear error, and calls already made
  are listed.

## Done when

- A real Claude Code session and a real Codex session each use `run_script` to read several child
  sessions in one call.
- [Agent tools](../../agent-tools.md) lists `run_script` and states the inner-call rule.
- [MCP](../../mcp.md#security) says that scripts run in an interpreter with no file, network, or
  process access, and that every inner call is checked like a direct call.

## Risks

- A bug in the interpreter is a bug in a security boundary. Pin its exact version, and read its
  changelog before every update.
- Agents might write long programs instead of short ones. The 20 KB input cap and the call limit
  keep the damage small.
- Harnesses with deferred tool loading, such as Claude Code, already save some of the context this
  tool saves. The round trips are the gain that doesn't overlap.
