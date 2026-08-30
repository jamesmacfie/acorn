# Deployables: two artifacts, one node, one `acorn`

`docs/future/bundle.md` owns how the node is packaged: native modules, the CI matrix, the snags, the
order. This file owns what is in each artifact once the TUI exists, and what that changes in
`bundle.md`'s claims. Where they overlap, `bundle.md` is the pipeline and this is the manifest.

## The two artifacts

| | Desktop | Headless |
| --- | --- | --- |
| Contains | Tauri shell, desktop helper, the node, the bundled Node runtime, `acorn` | The node, the bundled Node runtime, `acorn` |
| Who installs it | Someone who wants the app | Someone with a server, a Linux laptop, or a container |
| How `acorn` gets on `PATH` | The app offers to link `acorn` from its bundle on first run, the way Visual Studio Code links `code` | The tarball has `bin/acorn`; the `curl \| sh` installer links it |
| What `acorn` does there | Attaches to the app's node if the app is running; starts one under the app's data root if not | Attaches to the service's node if it is running; starts one if not |
| Per platform | macOS arm64 and x64 (Gatekeeper gates it, `bundle.md § The snags`), Linux, Windows | The same five triples `bundle.md` names |

Ignoring per-OS copies, that is two deployables. The node inside each is the same build; `acorn`
inside each is the same build; the desktop adds Tauri and the helper. "One node, three supervisors":
the helper, the TUI, and a service manager, each starting the same `standalone.js` under the same
pinned runtime (`node-runtime.json`, read by both `apps/desktop/scripts/stage.mjs` and
`scripts/pack-node.mjs`).

A container image stays node-only. `docker exec -it <container> acorn` attaching from inside is
plausible and is not promised; phase 7 decides after the tarball ships.

## What changes in `bundle.md`'s claims

- **"node-pty is the only native module left."** It was. OpenTUI's render core is Zig, published as
  `@opentui/core-<triple>` packages with a prebuilt library each. Two native modules, both
  prebuilt per platform, both with Linux as the platform that needs a CI-produced build if the
  upstream prebuild does not cover a triple. `scripts/rebuild-node-abi.mjs` probes one; it probes two.
- **"Requiring a modern Node is a reasonable ask of someone deliberately installing a headless
  service."** It is not a reasonable ask of someone who typed `acorn`. Bundling the runtime moves from
  the last step of `bundle.md`'s order to before the headless artifact carries the TUI. The desktop
  already bundles it (`tauri.conf.json`, `externalBin`), so the cost is tarball size, about 50 MB.
- **Node SEA is still not the path.** Two native modules now instead of one.
- **"Five tarballs on a release"** stays five. `acorn` rides inside the node tarball; it is not a
  sixth artifact.
- **The barrel rule** ("a barrel reachable from a node composition root must not re-export a
  desktop-only module") gains a mirror: a barrel reachable from the TUI composition root must not
  re-export a DOM-only module. Client-core's `kit/` is DOM-out by design and that is fine, because
  the TUI imports the kit's *contract* (`kit/tokens/`) and its own components, not
  `kit/components/primitives.tsx`. The arch test that holds the first rule holds the second.
- **The Windows pairing snag** (`SIGUSR1` does not exist there) gets a second answer: a TUI attached
  to the local node can offer "open a pairing window" as a command. Noted in `bundle.md`, designed in
  phase 3's doors left open.

## What `pack-node.mjs` grows

- A second entry, `dist/tui.js`, built by the same Vite config with `HOST = 'tui'` and OpenTUI as an
  external.
- `bin/acorn`, a shebang wrapper that finds the bundled runtime beside it and runs `dist/tui.js`.
- `@opentui/core` and its platform package in the generated `package.json`'s real dependencies.
- The runtime, once bundling lands.

## What the Tauri bundle grows

- `acorn` as a second `externalBin` or as a resource beside `helper/`, with the same runtime.
- A first-run offer to link it, behind a setting, off by default in the sandboxed build.

## Signing

A downloaded `acorn` with a `.node` or `.dylib` inside is quarantined on macOS like the node tarball
is. The Developer ID purchase that gates desktop auto-update and the node tarball gates this too.
Linux and Windows first, macOS when the ID exists. Nothing new; the same gate, one more thing behind
it.
