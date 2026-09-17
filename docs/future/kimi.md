# Kimi Code as a contributed harness

Status: proposal, 2026-09-18. Nothing here has started, and nothing here needs a change inside acorn.

Kimi Code CLI ships `kimi acp`, an official Agent Client Protocol server over stdin and stdout, which
makes it a tier 1 harness: one manifest, no driver, no branch in `plugins/agents`. This file records
what a package for it looks like, the four declarations a future author would otherwise get wrong,
and the Kimi API research behind the optional usage and auth probes.

Owning docs win where this disagrees with them. [managed-agents.md](../managed-agents.md#harnesses)
holds the two driver tiers and the delivery seam, and
[the manifest](../plugin-authoring/the-manifest.md#harnesses) holds the authoring contract. Neither is
restated here.

## Why this one, and why from outside the repository

The interesting part is not Kimi. The harness seam has a single acceptance test,
`apps/node/test/integration/harnessContribution.test.ts`, and that test writes its own fixture
manifest into a temporary directory. No package has ever contributed a harness from outside the
repository. Kimi would be the first, so anything the seam cannot express turns into a bug report
against the seam instead of a special case inside the agents plugin.

Kimi advertises session loading, resume, close, delete, fork, model and mode configuration, images,
embedded context, permission requests, and form elicitation. That is close to the set acorn's generic
driver already consumes, which is what makes it a fair test rather than a lucky one.

The package is a standalone folder installed by local path, the same shape the machine-stats plugin
uses. A first outside installation is the thing under test, so putting it in `plugins/` would prove
nothing.

## The manifest

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-plugin.schema.json",
  "id": "kimi",
  "name": "Kimi Code",
  "version": "0.1.0",
  "apiVersion": "12",
  "icon": { "d": "PLACEHOLDER_24x24_PATH_D", "color": "#1f1f1f" },
  "node": "./node/index.js",
  "permissions": {
    "node": {
      "net": ["api.kimi.com"],
      "env": ["KIMI_TOKEN", "KIMI_API_KEY"],
      "files": [{ "env": "KIMI_CREDENTIALS", "access": "read" }]
    }
  },
  "contributions": {
    "harnesses": [
      {
        "id": "kimi",
        "label": "Kimi Code",
        "glyph": "brand:kimi",
        "spawn": { "command": "kimi", "args": ["acp"] },
        "envPassthrough": ["KIMI_*"],
        "quirks": { "manualCompaction": true, "sessionPersistence": false },
        "terminal": { "command": "kimi" },
        "probes": { "usage": "/v2/p/kimi/usage", "auth": "/v2/p/kimi/auth" }
      }
    ]
  }
}
```

The runtime id is `kimi:kimi`. The host mints it by prefixing the harness id with the plugin id, and
it is persisted as a session row's `providerId` and a workflow step's `profile`. Renaming it later
breaks every session a user already has, so it is a decision taken once.

Drop the `node` key, the `permissions` block, and `probes` and the rest still works. That is the
version to ship first if nobody wants to maintain the probe half.

### Start `sessionPersistence` at `false`

Acorn reads this quirk off the manifest, not off ACP capability negotiation, so declaring it is an
assertion rather than a report. What it buys is the terminal handoff: a harness that declares no
session persistence has no `resume` in its driver capability list, and the pane's "Continue in
terminal" action stays disabled. It is not what makes acorn pick a session back up after a restart —
the driver takes that from whichever of `session/load` and `session/resume` the agent advertises at
`initialize`, so Kimi gets it either way.

Kimi is widely described as persisting sessions, and it probably does. The asymmetry is what decides
it. Turning the quirk on after a conformance run confirms the handoff works is a version bump that
breaks no stored data. Turning it on first and discovering it does not work puts an action in the pane
that fails in front of a user.

### Leave `terminal.oneShot` out of the first version

Declaring it lists Kimi in every Generate control in acorn, beside the owner's connected API keys.
The cost is the `output` field, which has no default and no safe guess: `text` reads all of stdout as
the answer, `json-lines` reads a newline-delimited stream and looks for a `result` event. Guess wrong
and every generate fails as unreadable output with nothing on screen explaining why.

Kimi's text mode adds transcript formatting, and its JSON stream is not known to carry the
Claude-style `result` event the line-delimited adapter expects, so neither value is obviously right.
Adding the block is two lines once somebody has run `kimi -p` with stdout on a pipe and read what
comes back. Until then the harness works in the Agent pane and a task terminal, which is most of the
value.

### The icon is one SVG path

Acorn takes a single `d` attribute authored in a 24 by 24 box, not an SVG document, because a
document means script tags, `use href`, event handlers, and an allowlist parser for a logo. Substitute
Moonshot's real mark when someone has it in that form.

### Keep `envPassthrough` narrow

`KIMI_*` covers the CLI's own configuration and its API key. The whole spawn plus the passthrough list
is the trust grant key, so widening the glob in a later version asks the owner to approve again.
Adding `MOONSHOT_*` before something needs it spends that for nothing.

## The probe half

Both probes are optional. Without them the Agent pane shows no usage section and the Agent Center
shows no provider-health row, which is the right answer for most agent CLIs. They are written up here
because the research behind them is the part nobody should have to redo.

### What the worker allows

A loaded plugin's node half runs in a permission-scoped worker realm,
`packages/node-core/src/server/plugins/isolation.ts` on the host side and
`packages/node-core/src/server/plugins/nodePluginWorker.ts` inside. Three consequences shape every
line of the probe code:

- The worker cannot import `net`, `http`, `https`, `http2`, `tls`, `dgram`, `dns`, or `quic`. Raw
  sockets cannot enforce a manifest host list, so network access is the wrapped global `fetch`, which
  compares the hostname exactly against `permissions.node.net` and never follows a redirect before
  rechecking it.
- The worker cannot import files outside its own package. There is no `zod`, no npm dependency, and
  no bare specifier that resolves. Parse the response by hand.
- `node:fs` works, scoped by Node's permission model to the paths a grant resolved.

The filesystem grant is the one that needs explaining to a user. A manifest cannot name
`~/.kimi-code/credentials/kimi-code.json`, because a package cannot bake one machine's absolute path
into something distributable. Instead the manifest declares
`{ "env": "KIMI_CREDENTIALS", "access": "read" }`, the host reads that variable from its own
environment at worker launch, and the resolved path becomes an `--allow-fs-read` grant. So the owner
exports `KIMI_CREDENTIALS` before the probes report anything. Say that plainly in the package README,
along with the fact that the harness itself works without it.

### How a probe is called

`ctx.routes.register` does not exist for a loaded plugin, because a Hono instance cannot cross a
worker boundary. `ctx.routes.fetch(handler)` is the door, and the host strips the mount, so a probe
declared as `/v2/p/kimi/usage` reaches the handler as `/usage`.

The host turns each declared route into an internal GET with a five-second ceiling
(`packages/node-core/src/server/pluginHost/host.ts`). There is no auth for the handler to check. A
non-2xx or a body that is not JSON arrives at the consumer as `null`, and the agents plugin treats
that the same as a harness with no probe at all.

### The Kimi API, second-hand

None of this was observed against a live Kimi account. It comes from reading paseo's quota fetcher at
`references/paseo/packages/server/src/services/quota-fetcher/providers/kimi.ts` in a local checkout,
which is a real implementation but still somebody else's reading of the API. Check it before trusting
it.

- Token order: `KIMI_TOKEN`, then `KIMI_API_KEY`, then `access_token` from the credentials JSON.
- `GET https://api.kimi.com/coding/v1/usages`, with `Authorization: Bearer <token>` and
  `Accept: application/json`.
- The body is `{ usage, limits }`. The `usage` object is the primary window and `limits` is an array
  of the rest, each of which may carry its numbers at the top level or nested under `detail`.
- Numbers arrive as strings. Coerce, then check with `Number.isFinite`.
- Reset time is spelled four ways in the same payload: `resetTime`, `resetAt`, `reset_time`, and
  `reset_at`.
- A window's label comes from `name`, `title`, or `scope`.
- Stay read-only on the credentials file. Refresh tokens are single-use, so redeeming one in a probe
  invalidates the CLI's own copy, and rewriting the file through a partial schema drops whatever
  fields the schema does not model.

### Mapping into acorn's shape

`plugins/agents/src/shared/harnessProbes.ts` is the boundary that parses both answers, and it is
narrower than what acorn's built-in probes produce. Cost and daily figures are not a harness's to
report, and acorn derives health and capture time from what is left, so one harness cannot call five
percent remaining healthy while another calls it critical.

For usage, map the top-level `usage` object to the quota with id `session`, the one the compact
indicator reads, and each `limits` entry to `limit_<index>`. Per quota:

- `percentRemaining` from `remaining / limit`, falling back to `1 - used / limit`.
- Run the reset value through `Date.parse`. Send `resetsAt` when that is finite, because acorn turns
  a timestamp into a live countdown, and `resetText` otherwise.
- No token, a non-2xx, or unparseable JSON all answer `{ "quotas": [] }`, which draws an empty
  section rather than an error.

For auth, a token found means `{ "authenticated": true }`. Nothing found means `false` with a
diagnostic naming `kimi login` and the `KIMI_CREDENTIALS` variable. A credentials file that exists but
will not parse means `null`, which the health row shows differently, because `null` means "cannot
tell" and sending someone to re-authenticate a working account is worse than saying nothing.

Two simplifications worth taking, each of which loses something small. Ignoring the `window.duration`
and `timeUnit` fields gives a quota a generic label instead of "5-hour limit". Ignoring `expires_at`
on the credential means an expired token reads as signed in until the usage call returns a 401. Both
are cheap to add once a real payload has been seen, and neither is worth guessing at beforehand.

## Verify before building

The probe half rests entirely on one second-hand read, so this list matters more here than usual.

1. Confirm `kimi acp` is still the subcommand. The version pinned in paseo's ACP catalog is 0.11.0.
2. Confirm the plugin API major is still 12 (`packages/protocol/src/plugin/apiVersion.ts`). A bump
   invalidates the `apiVersion` string above.
3. Confirm the harness descriptor still has the fields the manifest block uses, in
   `packages/protocol/src/plugin/contract.ts`.
4. Call `api.kimi.com/coding/v1/usages` with a real token and compare the body against the field
   names listed here before writing the mapping.
5. Confirm the filesystem grant still resolves through an environment variable and still refuses
   paths inside acorn's data root (`packages/node-core/src/server/plugins/isolation.ts`).

## Live conformance

Run this once Kimi is installed and signed in, before calling the package done. Start a session in the
Agent pane and check each of:

1. Prose, reasoning, plans, and tool calls stream into the transcript.
2. A file write and a shell command can each be approved and rejected.
3. A form question arrives as a card and its answer reaches the agent.
4. An image attaches and the agent sees it.
5. Model and mode can be changed, and the choice is remembered for the next session.
6. Compact works, which is what `manualCompaction` claims.
7. A turn cancels mid-flight.
8. The node restarts and the session reloads, which is what decides `sessionPersistence`.

One thing to watch throughout. Acorn declines ACP's `fs`, `terminal`, and `mcpServers` capabilities at
`initialize` (`plugins/agents/src/server/drivers/acpDriver.ts`), so the question is whether Kimi falls
back to its own local tools and still sends permission requests, or whether it degrades. Also check
whether Kimi's subagents carry enough ACP metadata to populate acorn's roster.

## Left open

Whether the descriptor ships bundled with acorn or stays an optional package installed by the owner.
The leaning is optional and loaded, because that keeps the seam honest and keeps a third-party CLI's
launch arguments out of acorn's release cycle. Decide it after the conformance run, not before.
