# The shell process

This page covers the Rust shell and the helper process it supervises: how they start, how the
renderer reaches the helper, where data lives, the data key, and the device config file. Read it
before you change the shell's startup or custody. It's part of [desktop shell](../shell.md).

## The shell process

`apps/desktop/src-tauri/src/lib.rs` registers the `app://acorn` and `app-plugin://` schemes,
supervises the helper, and opens the window. `setup` waits for the helper and nothing else, because
the renderer's first act is to ask which Nodes exist, and the fleet is a file on the helper's disk.

The ready line means the helper is listening, not that the Node is up. `boot()` in
`apps/desktop/src/helper/helperMain.ts` loads the env files, builds the helper, binds the WebSocket
server, and prints the ready line. Only then does it start the Node with
`helper.startInBackground()`. So the window opens on a helper that can answer the fleet question, and
the Node boots behind the startup loader. Its first `node-status` push releases the renderer gate
([startup readiness](../frontend/data-and-startup.md#startup-readiness)).

`startInBackground` routes a `start()` that rejects before spawning a child into the same crash
budget and recovery dialog a later crash reaches, over the shell. A helper that never becomes ready is
fatal, because nothing in the window can reach a Node without one, so Rust says why and quits.

The Rust half stays small. `app_scheme.rs`, `plugin_scheme.rs`, and `webviews.rs` serve content.
`helper.rs` supervises the helper, and `keychain.rs` holds the data key. `commands.rs` and `menu.rs`
carry the window's own commands and menu. `overlays.rs`, `notifications.rs`, `crash.rs`,
`footprint.rs`, `cli_install.rs`, and `dev_server.rs` cover native overlays, banners, crash records,
memory readings, the CLI launcher, and the development server check. Custody is TypeScript.

`packages/custody` is the other half, composed by its `src/index.ts`: service supervision and the
restart policy, the connection broker and its fleet, device-token custody, the plugin cache and trust
store, and the preview tunnels. It runs as its own process under the bundled Node, with
`apps/desktop/src/helper/helperMain.ts` as its entry. Rust talks to it over stdin and stdout in lines:
one handshake line in, one ready line out, then commands. Never through argv or the environment,
because the handshake carries the data key and argv is world-readable.

### The renderer socket

The renderer talks to the helper over one loopback WebSocket, authenticated by a per-launch secret
and checked against the window's origin on upgrade. `apps/desktop/src/shell/wire.ts` lists its
messages.

Each authenticated socket owns a disposable UUID in `apps/desktop/src/helper/rendererConnection.ts`.
The renderer declares `node-interest` from its selection, including the remembered first selection and
equivalent or cached switches. Only that Node's event payloads reach the socket, and every Node's
connection status reaches every renderer. Fleet reads, malformed requests, and cleanup for a previous
Node don't change interest. `null` is a fetch-only observer. An old client that never declares
interest keeps wildcard forwarding. The renderer keeps its own Node filter as a second check.

`node-fetch` request handles are namespaced by the socket's UUID after validation, and HTTP request
and trace headers keep their values. A renderer can abort only its own handles, and closing its socket
aborts its pending reads without cancelling another renderer's. Success, failure, and close release
the registry, and a late response isn't sent after close. Cancellation stays status 499, deadlines
stay `TimeoutError`, and transport failures keep their connection-health meaning.

The helper's response codec uses a native `Buffer` view over the exact byte range, and the renderer
codecs stay Node-free. Response assembly concatenates fragments once and exposes a plain
`Uint8Array`. Event JSON and Node-tagged bytes are encoded once, for the first open recipient, and
reused for the others.

The shell never imports plugin engines, database handles, or Node source. Domain behavior belongs to
the Node.

## Startup: data directory, environment, and the singleton lock

The app-data root, which holds the SQLite databases, blobs, worktrees, and notes, is
`<checkout>/apps/node/.acorn` in a development checkout, and the OS application-data path in a
packaged build. The shell's custody root is separate: `fleet.json` and the encrypted device tokens
belong to the app, not the Node. Packaged, it's the application-data directory itself, with the Node's
root beneath it. In a checkout it's `apps/node/.acorn-shell`, or `<ACORN_DATA_DIR>-shell` when that
variable is set.

Secrets load from `.env` in two places, in order: the build's own file, then a `.env` inside the data
directory, which wins. Without `SESSION_ENC_KEY` in either, the Node generates its own, before the
listener accepts connections.

`tauri_plugin_single_instance` makes a second launch focus the running window. The data root's
exclusive lock (`packages/node-core/src/server/storage/dataRoot.ts`) is the real guard, and the
single-instance plugin keeps a second launch from getting that far. The automation-only debug build
leaves it out, because each of its windows has its own data root.

Quitting asks the renderer first. **Quit** is a custom menu item, because
`PredefinedMenuItem::quit` goes through `[NSApp terminate:]` and skips the event loop. The menu item
and `RunEvent::ExitRequested` emit the same event to the renderer, which collects concerns and answers
`quit_approved`. The recovery screen's `force_quit` skips this, because the app shell isn't mounted
behind the recovery gate.

## Keys and custody

Rust holds one secret: a 32-byte data key in the OS keychain, under service `acorn` and account
`data-key`. It reaches the helper in the stdin handshake and is never written to disk there. Device
tokens are encrypted under it with AES-256-GCM.

There's one key, not one per token, because per-token keychain items mean a prompt per Node and
access-list churn on every rebuild. On macOS, a keychain item's access list binds to the code
signature, so while the app is ad-hoc signed every rebuild re-prompts or loses access. The fallback is
a `0600` file beside the fleet, and a development build always uses the file. That's the same stance
`deviceTokenStore.ts` takes, with the same blast radius as the Node's `session.key`.

The helper opens only this installation's custody root, and reads no credentials from another root.

## Device config file

The helper owns `<userDataDir>/acorn.json`, a data-only copy of covered device preferences and
requested device plugin sources. It watches the directory and sends `config-changed` to the
renderer. Reads and writes cross the helper socket as `config-read` and `config-write`, and
`config-location` supplies the path for Settings. Settings can ask the shell to open the file, and the
shell creates an empty object first when it doesn't exist. The helper writes atomically and keeps
unknown keys from the last valid file. A parse error returns its line and column and keeps the last
valid configuration. The schema is generated from `@acorn/protocol/deviceConfig.ts` and committed as
`packages/plugin-types/acorn-device.schema.json`.
