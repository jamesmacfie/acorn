# Installing plugins

This page covers how a package reaches a Node and how an owner's consent follows it: the install
route, agent install requests, folder installs, and development mode. Read it before you change the
installer or how trust is granted. It's part of [plugin security](./node-plugin-security.md).

## The install route

The only way a package reaches a Node's install directory is `POST /v1/core/plugins/install`, which
is device-only, needs an `Idempotency-Key`, and writes an audit row. The source is a GitHub release,
an npm package, a URL, or a folder. Nothing reaches a device until the Node's owner has installed it,
and nothing runs on a device until that device has accepted the exact bundle bytes
([third-party plugin bundles](./plugin-bundles.md)).

## An agent can ask for an install, not perform one

The `plugin_request` agent tool raises a request and rings the owner's bell. It holds nothing that can
install code. A task token is refused by every route under `/v1/core/plugins`, and the module that
implements the tool imports no installer, data root, or filesystem, which a test pins. On approval the
device performs the install with its own principal. The owner decides in the shell's own chrome,
which a plugin frame can't draw over, and a frame can never reach the answer route.

The installer validates a manifest only after it fetches, so approval takes two screens. The agent's
ask, with its action, source, and stated reason, gates the fetch. A second screen shows the real
manifest read back off disk before anything runs. A durable marker is written before the package
reaches its installed path. Boot and reload refuse a marked package and withhold its client bundle.
Approval (`POST /v1/core/plugins/:id/review`) checks the marker's generation and the package
fingerprint, then clears it. Dismissing the review leaves the package held across restarts, and its
page under **Settings > Plugins > Installed** can approve or remove it. A No uninstalls it.

## Installing from a folder

`{ path }`, an absolute directory on the Node's filesystem, is an install source on every build,
packaged ones included. The scaffold (`npm create acorn-plugin`) writes a directory and the authoring
guide's last step installs it, so an author can run a plugin on any machine.

A folder install is the owner naming bytes that are already theirs, on a filesystem the Node already
reads and writes as the same user:

- **A folder only the Node's user can write**, such as a home-directory checkout, adds no authority.
  Whoever can write it can also write the install root beside it, `<data>/plugins/<id>/` at mode
  `0700`, the Node's binary, or the user's shell profile.
- **A wider folder is the real cost.** The install root is `0700`, but the named folder has whatever
  mode it has. A group-writable checkout, a shared or network mount, a synced folder, or `/tmp`
  turns write access to that directory into code execution as the Node's user at every restart. acorn
  doesn't check the mode, because a mode check would be a boundary shaped like advice. The install
  form says the folder is linked, not copied. **Point acorn at a directory only you can write.**
- **The node half** gets the same isolated realm and grants as any other source.
- **The client half** is unaffected. Device consent is keyed on the hash of the bytes that arrive, so
  editing the client file produces a new hash and a new prompt.

The directory is symlinked rather than copied, which is what makes edit-in-place work, so there's
nothing to pin. The lockfile records `archiveSha256: null` and an empty `entrypoints` map, and a test
keeps it that way. A digest captured at install would go stale on the author's next keystroke and read
as provenance it isn't. A folder install sits outside [supply chain](./plugin-storage-and-supply-chain.md#supply-chain)
protection, and signing will never cover it. The owner vouched for a directory, not a version.

The path must be absolute, because a relative one would resolve against the Node's working directory.
The Settings folder picker is offered only for a local Node, because the dialog browses this device's
filesystem while the Node resolves the path on its own. For a remote Node the owner types a path.

## The dev grant

A device-held plugin uses a grant for `(pluginId, { kind: 'device' })`. It can't auto-accept a
Node-delivered bundle with the same id. Removing the device plugin revokes the grant and its automatic
acknowledgements, and decisions the owner made in the prompt stay.

Per-hash consent is right for distribution and wrong for iteration. A plugin the owner is developing
can go into **development mode**: a grant stored on the device per `(pluginId, nodeId)`, beside the
acknowledgements, that auto-accepts later bundles of that plugin from that Node. A grant keyed on the
plugin name alone would trust a bundle a different Node offered under it.

The grant writes ordinary accepted acknowledgements, in the helper, beside the hash it computed. The
renderer can't turn a bundle into an accepted one with or without a grant. Each row is marked `dev`,
so revocation can find it, and `partial`, because nobody read a disclosure, so it can never be the
baseline of a later diff.

**While a plugin is in development mode, the node half an agent writes is accepted on the next load
without a per-save human read.** It still runs in the same permission-scoped realm, but the owner has
waived bundle-by-bundle review for that pair. Three things bound it:

- **Visible.** The plugin's row under **Settings > Plugins > Installed** says *In development. Bundle
  changes are trusted without asking*.
- **Revocable.** Ending development mode drops the grant and every acknowledgement it wrote. What's
  left is whatever the owner answered by hand, so the current bundle is undecided again and the normal
  prompt fires on the next distribution pass.
- **Auditable.** Every approval that entered development mode is a `plugins.request.decided` audit row
  carrying the action, the decision, the `dev` flag, and the task whose agent asked.

The grant is a device-side decision, independent of source. Over a remote source it means only that
later versions of this plugin don't prompt, and each iteration there is still an explicit update.
