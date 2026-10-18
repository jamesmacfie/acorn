# Phase 4: Add the run_script tool

Date: October 16, 2026. Status: done on October 19, 2026, except the real Codex check.

## Completion note

October 19, 2026. Landed on branch `phase-4-script-tool`.

What landed:

- `callAgentTool` in `packages/node-core/src/server/agentTools/callTool.ts` holds every check after
  authentication, in the order `invoke` had them, then runs the tool. The route and `run_script`'s
  inner calls both use it, and the route keeps only authentication and the task check. It returns a
  `ToolCallResult` with the status and error code, so a program sees the answer a direct caller gets.
- `ToolContext` gained an optional `callTool`. `callAgentTool` sets it only when the tool is core's
  `run_script`, and an inner call to `run_script` gets the same 404 as a missing tool. Inner calls
  get the outer call's identity, never its provenance proof, and the IDs `<outer>:<n>`.
- `run_script` registers in `coreTools.ts` and loads `runScript.ts` with `await import()`. Only that
  module imports QuickJS. The result is `{ ok, value, logs, calls }`, or `ok: false` with
  `error: { message, line }`. Each `calls` entry is `{ tool, ok, error? }`, and a call still pending
  when the program ends reads `cancelled`.
- The agents plugin draws a transcript card for `run_script`: the calls with their outcomes, the
  error and line, and the program in a closed fold.
- Both QuickJS packages are in `requiredRuntimePackages`, `packages/node-core`, and
  `apps/desktop/package.json`, pinned at 0.32.0. Staging them with `stageRuntimeDependencies` copied
  the `.wasm` file, and the built `runScript` chunk ran programs from there.
- Docs: a Scripts section in [agent tools](../../agent-tools.md#scripts), one sentence in
  [MCP](../../mcp.md#security), and a row and a paragraph on the site's agent tools page.

Deviations:

- One wasm module per program, not one per process. A value nested about 200,000 levels deep makes
  `JSON.stringify` inside QuickJS overflow Node's own stack, at every stack limit I tried. The host
  sees a `RangeError`, freeing the runtime then aborts, and the module is unusable after that. A
  fresh module costs a median of 1.1 ms after the first 5 ms load, so no program can break another,
  and the 2 GiB shared-memory concern goes away. The runner reports this case as "The interpreter
  failed" and the next program runs normally.
- The stack limit is 256 KiB, not 512 KiB. At 512 KiB plain recursion overflowed Node's stack before
  QuickJS's own check, with the same crash. At 256 KiB QuickJS throws "stack overflow" first.
- Only `return` gives the result. A last bare expression gives `null`. QuickJS-emscripten has no
  flag for top-level `await` in a script, and finding the last expression means parsing the program.
  The tool description says to use `return`.
- A program reaches read-tier tools only. The doc had each inner call checked against its own tier,
  so a script could write when the write tier was on. A security review after the first commit
  pointed out that a harness asks the person about a write by the tool's name, in Claude Code's own
  permission flow and through `agents:before-tool`. Inside a script those see only `run_script`, a
  read tool, so a write would skip the person's approval. The inner calls' ceiling is narrowed to
  `maxRisk: 'read'`, which keeps any workflow `allow` list. The doc's write test became "every
  write is refused", and the ceiling test uses an `allow` list. Allowing writes later needs a way
  to ask the person about each inner write, not just a wider ceiling.
- A harness rule or `agents:before-tool` policy that names one read tool doesn't see that tool's
  calls inside a script. The Node's per-tool switches and `core:before-tool-call` still apply, and
  the owner can switch `run_script` off. The same review suggested defaulting it off, or running
  the loop hook for each inner call. I documented the gap in agent tools, loop hooks, and the
  permissions page instead, and left the default for the owner to decide.
- A program's own JavaScript gets 1 second in total, counted only while the engine runs. QuickJS
  runs on the Node's event loop, so the doc's 120-second limit let `while (true) {}` freeze every
  session and request on the Node for two minutes. A second security review caught it. An
  interrupt in QuickJS ends the program and can't pause it, so slicing wasn't possible. A worker
  thread would remove the limit's reason, at the cost of carrying tool calls across a message port.
- The input cap is 20,000 characters, checked by Zod, not 20 KB.
- No cap on concurrent scripts. Each holds at most 32 MiB of engine memory and 1 second of the
  event loop.
- The route file reads a body it doesn't parse itself, so `tools/arch/boundaries.test.ts` lists it
  as allowed: `callAgentTool` parses it with the tool's own schema.
- The service graph is 1,884,361 bytes, 39 under the 1,884,400 ceiling. The first description was
  47 bytes over, so I shortened it. I didn't raise the ceiling. The next phase that adds boot code
  has to find room.

Real-harness check, on a Node run from this branch's source with its own data folder:

- Claude Code: two child sessions answered one word each. A third session made one `run_script`
  call whose program called `agent_session_list` and then `agent_session_read` for both children
  with `Promise.all`. The result listed three calls, all `ok`.
- Codex: not checked. A managed Codex session on that Node reported no Acorn tools at all, which the
  project memory `drive-managed-sessions-on-a-worktree-node` records as a known gap of a standalone
  Node. Wiring `codex exec` to the scratch Node needed a task credential from its data folder, and
  the sandbox refused that read. Check it from a desktop dev session.

For later phases:

- A tool that needs to call other tools gets `ctx.callTool` only if `callAgentTool` sets it. Widen
  that check on purpose, never by default. The same goes for the read-tier ceiling on inner calls.
- Read the QuickJS changelog before moving off 0.32.0, and rerun the stack tests in
  `runScript.test.ts`. They pin the two Node-stack crashes above.

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
