# Node boot

Date: 2026-09-24. Status: proposal. [Back to the plan](./README.md).

The desktop starts its node on every launch and stops it on quit ([shell.md](../../../shell.md)
§ Node child). Since 2026-09-17 the shell does not draw until that node reports its first status
([04](./04-first-frame.md)), so node boot time is loader time. The September programme left the
node's own boot at about 121 ms to `listener-up` on a packaged build. What it could not fix was the
time before the node's clock starts: spawning the process and evaluating the service bundle.

## What was measured

All numbers are from the pinned runtime, Node 24.11.0, importing the staged service chunk
`apps/desktop/dist/helper/chunks/crash-BxUhyi6G.js` (1,910,384 B) in a fresh process, five runs each.
The first run of each set is the cold one.

| Variant | Import time |
| --- | --- |
| As shipped | 433, 380, 369, 377, 371 ms |
| With `NODE_COMPILE_CACHE` set | 383, 355, 346, 349, 336, 345 ms |
| Pure-JavaScript dependencies inlined with esbuild | 132, 135, 131, 130 ms |
| Inlined, with `NODE_COMPILE_CACHE` set | 143, 100, 100, 104, 109 ms |

Importing each external dependency alone, in order, in one process:

| Dependency | Run 1 | Run 2 |
| --- | --- | --- |
| `drizzle-orm` | 122 ms | 102 ms |
| `drizzle-orm/sqlite-core` | 89 ms | 80 ms |
| `@agentclientprotocol/sdk` | 54 ms | 37 ms |
| `jose` | 24 ms | 16 ms |
| `pg` | 19 ms | 9 ms |
| `@hono/node-server` | 16 ms | 9 ms |
| `ws` | 14 ms | 11 ms |
| `hono` | 10 ms | 5 ms |
| Everything else together | about 30 ms | about 20 ms |
| The bundle's own code, dependencies warm | 98 ms | 111 ms |

The drizzle figure is not drizzle's code. Importing `drizzle-orm` and `drizzle-orm/sqlite-core` loads
107 separate files and takes 183 to 199 ms. The same two entry points bundled by esbuild into one
184 KB file take 3.3 to 3.8 ms to import. The cost is the Node module loader resolving and linking
107 files one by one, not the work inside them.

That corrects a conclusion in the September record. Phase 3 found that external libraries were most
of the evaluation cost and refused per-plugin chunks, correctly, because every plugin initialises on
every boot. It did not test bundling the externals themselves, and that is where the time is.

## N1: Inline pure-JavaScript dependencies into the service bundle

**Change.** `apps/node/vite.config.ts` externalises every bare import through
`externalizeBareImports`. Replace that with an explicit list of what must stay external, and bundle
the rest. What must stay external:

- Native addons and packages that ship binaries or resolve files next to themselves: `node-pty`,
  `@vscode/ripgrep`, `fsevents`, and the optional `bufferutil`, `utf-8-validate`, and `pg-native`.
- Packages the node spawns or loads as separate programs: `@agentclientprotocol/claude-agent-acp`
  and `playwright-core`.
- Node built-ins, as today.

The experiment above used exactly that external list and a `createRequire` banner for the CommonJS
dependencies, and the resulting chunk imported and evaluated without errors. It did not start the
service, so treat it as a sizing experiment, not proof that everything works.

**Expected gain.** About 215 ms off every cold start, from about 345 ms to about 131 ms of bundle
evaluation, before [N2](#n2-turn-on-nodes-compile-cache).

**Why at this layer.** The node's build config already decides what is external. Nothing about the
service's runtime shape changes: it still runs as one process under the pinned runtime, and the
helper still spawns it the same way.

**Risks and costs.**

- The bundle grows from 1.9 MB to about 3.2 MB, and the app's `node_modules` still carries the
  packages for anything that stays external. Check `apps/desktop/scripts/verify-bundle.mjs` for
  assumptions about which packages exist beside the helper.
- Some packages read files relative to their own location at runtime, for example a migrator that
  reads SQL files or a package that reads its own `package.json`. Drizzle's migrator reads the
  migration folders the node passes it, so it should be fine, but run the boot test and the full
  node suite.
- The `node:sqlite` shim (`packages/node-core/src/server/storage/sqlite.ts`, see
  [data-layer.md](../../../data-layer.md)) must still never reach drizzle's `better-sqlite3` front
  door. Bundling does not change which modules the shim imports, but confirm that
  `better-sqlite3` does not appear in the bundle.
- Licence notices. If the release process collects licences from `node_modules`, it has to collect
  them for inlined packages too.
- The standalone and MCP entries share the config. Decide whether they bundle the same way. The
  standalone node on a machine's own Node is the case to check.

**Done when.** `apps/desktop/test/boot.test.ts` passes with the inlined bundle, the gap between the
helper's `service.start` mark and its `ready line` drops by at least 150 ms against the same test on
the old build, and the numbers are recorded in [performance.md](../../../performance.md).

## N2: Turn on Node's compile cache

**Change.** Have the helper set `NODE_COMPILE_CACHE` to a directory under the app's cache root when it
spawns the node (`packages/custody` service supervision, beside the existing `spawn` call). Node 22.1
and later then keep V8's compiled code for every module on disk and reuse it on the next launch. The
alternative, `module.enableCompileCache()` at the top of the entry, works too, but it has to run
before the rest of the graph loads, which means splitting the entry. The environment variable does
not.

**Expected gain.** About 30 ms as shipped, and about 30 ms on top of N1. Small, but it costs one line.
The first launch after an update is cold, because the cache is keyed on file contents.

**Risks.** A stale cache is rejected by Node itself when the source changes. Put the directory where
a reset or an uninstall clears it, and keep it out of the data root, which is user data.

## N3: Load rarely used heavy dependencies on first use

Two dependencies are loaded on every boot for features most launches never touch:

- `@agentclientprotocol/sdk`, 37 to 54 ms as a separate import. The September record named it
  already: it is needed when a managed agent session starts, not at boot.
- `pg`, 9 to 19 ms, pulled in by the database plugin for Postgres connections.

After N1 these cost much less, because most of their time is the same per-file loading cost. Measure
again after N1 and do this only if either is still over about 10 ms. The change is a dynamic
`import()` at the point of first use, inside the plugin that owns it.

## N4: Stop shipping stale service chunks

**What was found.** `apps/desktop/scripts/stage.mjs` copies `apps/node/dist` into `dist/helper` with
`cpSync` and never clears `dist/helper/chunks`. At `8bf4a71b` that folder holds 24 files, 15 of them
old copies of the service chunk at about 1.9 MB each. `src-tauri/tauri.conf.json` bundles the whole
`dist/helper` folder as a resource, so a local `pnpm dist` ships roughly 26 MB of dead code. A clean
CI build does not, but a local release does.

**Change.** Remove `dist/helper/chunks` before the copy, the same way the script already removes
`dist/helper/migrations`.

This does not change launch time, because only the imported chunk is read. It changes app size,
signing time, and how confusing the folder is to read.

## What is not worth doing here

- **Spawn cost.** Forking the node is 23 ms (September phase 3). Leave it.
- **Migrations and SQLite opens.** 30 ms for ten databases warm. The September record already refused
  a journal check.
- **Keeping the node running after quit.** It would make the second launch instant, but it changes the
  supervision model and the data-root lock rules in [shell.md](../../../shell.md). See
  [refused.md](./refused.md).

## Verify before building

- Re-measure with the recipe above at your commit. The service chunk's file name changes every build.
- Confirm the helper spawns the node with `spawn(process.execPath, [entry])` and an environment you
  can add to.
- Confirm no bundled package uses `__dirname` or `import.meta.url` to find a data file that the
  bundler will not copy. Search the inlined output for `readFileSync(` near a path join.
- Confirm `playwright-core` is only reached through a dynamic import, so keeping it external costs
  nothing at boot.
