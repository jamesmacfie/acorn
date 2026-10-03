# Third-party plugin bundles

This page covers how a device decides whether to run a plugin's client bundle: hash-bound consent,
custody on the desktop and in the terminal, and the threats that closes. Read it before you change
how bundles are fetched, cached, or trusted. It's part of [plugin security](./node-plugin-security.md).

## Where bundles come from

A plugin installed on a Node is distributed by that Node. Its client bundle travels the broker pipe to
every paired device, which makes a Node a source of executable code. So the bundle is gated twice,
once on content and once on consent.

A device-held plugin has no Node half. The desktop helper fetches the package from the source the
owner entered, applies the Node installer's archive and manifest checks, refuses Node entries and
Node-dependent contributions, and hashes the client bundle before caching it. The client checks the
manifest again before it registers anything. Device-held and Node-delivered bundles use the same
sandboxed iframe and tree-worker paths, and neither runs in the shell process.

Cache entries and acknowledgements carry `{ kind: 'node', nodeId }` or `{ kind: 'device' }`
provenance. An old acknowledgement with a `nodeId` and no source reads as Node-sourced. The prompt
names the source as the owner entered it, warns that a folder isn't pinned, and leaves out the Node
execution disclosure for a device bundle.

## Trust binds to bytes and the approved declaration

The hash a Node advertises in `/v1/core/plugins` is untrusted input. The helper fetches the bundle
itself, so the bytes never pass through the renderer, hashes what arrived, and stores it under that
hash. A mismatch with the advertised value is refused and reported, never re-keyed. Every
acknowledgement binds a plugin id to a hash only this device computed.

An acknowledgement also stores a canonical projection of what the owner reviewed: the API version,
permissions, contributions, and emitted events. A Node that changes that projection under unchanged
bytes loses the selection and asks for another review. Acknowledgements older than this binding have
no projection, so they fail closed and prompt again. Identical bytes from two sources share one
decision only while their enforced declarations agree with the one approved.

The terminal client has no helper, so it uses the same two stores itself, `@acorn/custody`'s
`PluginCache` and `PluginTrustStore`, pointed at `$XDG_CONFIG_HOME/acorn/plugins/`. Same schemas, same
`(pluginId, hash)` key, same refusal on a mismatch, and the same `0700` directory and `0600` files.
`apps/tui/src/plugins/custody.ts` is the only file in that package allowed to name either class.

## Consent is per device and per bundle

The first sight of a `(plugin, hash)` pair prompts, naming the Node it came from and the permissions
the manifest declared. An update arrives as a new hash and prompts again, showing what the permissions
gained. A rejection is remembered. Pairing a new machine prompts again, because the decision is about
code this machine will run. Repository config trust is the same idea one level out: it binds a project
to the hash of a config the Node runs, and this binds a plugin to the hash of a bundle the device runs.

The Node reports its running declaration apart from the package on disk. Custody can cache both, but
the renderer runs only an accepted bundle that matches the running identity, so a pending disk update
can't replace accepted UI while the older node half still runs. Acceptance is recorded before the
distribution snapshot enables contributions. Revoking an exact hash removes its registrations and
stops its worker. If two Nodes attach conflicting declarations to one key, the client withholds it.
First-party auto-acceptance records the declaration read from app-owned resources, so a Node can't
widen it by claiming the same hash.

**What "gained" means.** Each permission line carries a stable grant key, separate from its sentence
(`packages/client-core/src/host/trust/permissions.ts`). The update diff compares keys, not wording, so
a reworded sentence never prompts again. A grant's severity rides beside the key as data.

Extension points follow the same rule. `extensionPoints[].kind` is a closed union of five
([plugins.md](../plugins.md#cooperative-extension-points)), and both directions appear under
**Enforced** with copy the host owns. A kind this build can't name is still disclosed as "reach into
X's Y". The host mints the point's public name, the provenance on everything delivered, and the
confinement of every route a contribution uses. A contribution that runs its own code needs this
device to have accepted that bundle, as a pane does. Hooks change what another plugin does, so two of
the three hook modes are drawn **high**, with the mode in the grant key. The hook chain fails open, so
a stalled handler can't brick a push. `core:before-tool-call` is the exception: it's an approval gate
and denies on timeout.

Frame key capture is manifest-bounded too. A frame may stop shell forwarding only for modified chords
listed in `claimsKeys`, and the trust prompt and Settings show those claims. Runtime code may narrow
the list, never extend it, and the palette, settings, task-switching, and Escape chords can't be
claimed.

## The application's own bundles

The shell caches and acknowledges the bundles in its own resource directory at every launch, because
only the build writes there (`packages/custody/src/plugins/bundledPluginTrust.ts`). That doesn't mean
a write at every launch:

1. The pass hashes one client body at a time. When the cache holds that hash and the file is on disk,
   it touches neither the body nor its index row.
2. It places missing bodies, then commits the successful cache rows in one atomic, fsynced index
   write.
3. It validates each trust disclosure, then commits the successful decisions in one atomic, fsynced
   trust write. The trust store compares field by field, ignoring `decidedAt`.

An unchanged pass writes nothing. A malformed sibling doesn't discard the successful packages. The
cache and trust files commit separately, in that order, so a failed trust commit leaves reusable bytes
without granting trust to them, and the next launch tries again. The hash is still computed from the
bytes every launch, so a changed bundle takes the full path. `ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1`
skips bundled cache and trust setup.

## The threats this closes

- **A hostile paired Node serving malicious JavaScript.** Hash-verified bytes, a per-device
  acknowledgement naming the Node, and the sandbox the bundle runs in
  ([client sandbox](./plugin-client-sandbox.md)). Nothing a Node pushes runs unprompted, and no path
  starts without an accepted hash.
- **A Node lying in its listing** about hash, version, or permissions. The hash is computed from the
  bytes. A Node that lies about permissions also controls the bytes, so the sandbox, not the
  disclosure, bounds it.
- **Cache poisoning.** Only custody writes the cache, and content addressing means a poisoned entry
  can't pass as a previously accepted hash.
- **Downgrade.** Resolution prefers the highest version whose plugin API major this client speaks. An
  older offer adds a candidate and can't evict a newer accepted one.
- **CSS injection through a theme.** A `themes` entry is the only manifest field whose content reaches
  the shell's stylesheet, so its values are refused, not escaped. A token value must be a hex literal
  or a flat colour function whose arguments exclude `(`, `)`, `;`, `{`, `}`, `<`, `\`, quotes, and
  control characters. Token names are host constants, and the selector is rebuilt from a bounded id
  alphabet ([plugin themes](../ui-design/appearance.md#plugin-themes)).
- **A contributed harness spawning something else.** A `harnesses` entry names a program acorn runs,
  so it's disclosed under **Enforced**. The host spawns exactly the declared command and arguments,
  and the whole spawn plus its environment passthrough is the grant key. The agent CLI itself is code
  the person installed, the same trust as running it in their own terminal
  ([harnesses](../managed-agents.md#harnesses)).
