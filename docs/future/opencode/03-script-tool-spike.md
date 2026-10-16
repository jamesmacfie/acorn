# Phase 3: Spike the script tool's interpreter

Date: October 16, 2026. Status: proposed.

This spike decides what runs the programs that phase 4's `run_script` tool accepts. Read it before
you add an interpreter to the Node.

## The question

`run_script` takes a short JavaScript program from an agent, runs it on the Node, and lets it call
Acorn tools. The program must not reach anything else. That means no files, no network, no
processes, no timers that outlive the call, and no Node internals. The interpreter is the only
thing that enforces this, so the choice is a security decision first.

## The candidates

| Option | How it isolates | Cost |
| --- | --- | --- |
| `@opencode/codemode` | A pure interpreter that runs only the syntax it implements. Programs can reach only the tools the host passes in. | MIT. About 4,700 lines of interpreter on the `acorn` JavaScript parser. Depends on Effect 4, which is in beta and which Acorn doesn't use. |
| `quickjs-emscripten` | A full JavaScript engine compiled to WebAssembly. A program sees only the functions the host injects. | Adds the engine's wasm file to the Node. Calling an async host function needs the asyncify build, or a promise bridge. |
| `node:vm` | None. Node's documentation says it isn't a security boundary. | Rejected. |
| A worker with Node's permission flags | Blocks files and processes, but not network access to the Node's own loopback port. | Rejected. |

## What to measure

For each of the first two options, build a throwaway proof of concept outside the shipped code and
record:

1. The bytes it adds to the Node bundle, against the service size budget. A clean tree was already
   over that budget on October 15, 2026, so this number decides a lot.
2. The time to create a runtime and run `return 1` with a cold start and a warm start.
3. Whether a program can call an async host function and await it, with two calls in
   `Promise.all`.
4. Whether a busy loop stops at a time limit, and whether a large array stops at a memory limit.
5. Whether these escape attempts fail: `globalThis.process`, `require`, `import()`,
   `Function('return this')()`, `fetch`, and reading a host object's prototype chain.
6. What a syntax error and a thrown error look like to the caller, with a line number.

For `@opencode/codemode`, also check whether the interpreter can run without Effect, by vendoring
the interpreter folder and replacing its Effect calls. If that's more than a day of work, say so,
and count Effect's size in item 1.

## The decision record

Write the result into [phase 4](./04-script-tool.md) under a "Decision" heading, then delete this
file. Record each measurement with its date, the option chosen and why, and the limits phase 4
should set. Those limits are the time limit, the memory limit, and the call count.

If neither option fits the size budget or passes every escape check, stop. Record why in this
folder's README and mark phase 4 dropped. A script tool that can be escaped is worse than no
script tool.

## Effort

About two days: one for each proof of concept and the measurements, and part of a day to write it
up.
