# The manifest

[Back to plugin authoring](../plugin-authoring.md)

## The manifest

`packages/protocol/src/plugin/contract.ts` is the schema, declared once because the node parses it off
disk and the client registers contributions from the same shape. Its top-level keys:

| Key | Required | What it is |
| --- | --- | --- |
| `id` | yes | Matches `/^[a-z][a-z0-9-]{1,31}$/` — 2 to 32 characters, lowercase, no dots. The dot ban is what keeps `<dataRoot>/plugins/<id>/` and `<dataRoot>/plugins/<id>.sqlite` in one directory without colliding. |
| `name` | yes | Display name, 1–120 characters. |
| `version` | yes | Free-form string, 1–64 characters. Compared on update by the installer's downgrade guard. |
| `apiVersion` | yes | A **range over plugin API majors** that has to cover this node's — `'12'` today (`packages/protocol/src/plugin/apiVersion.ts`). Write `"12"` unless you have checked your plugin against another major too, in which case `"11 || 12"` or `"10-12"`. Anything the range does not cover, and anything that is not a range at all, is a `failed` roster row with both versions in its reason. |
| `icon` / `icons` | no | One SVG path `d` string, or a map of them, authored in a 24×24 box. Not an SVG document — a document would mean `<script>`, `<use href>`, `on*` handlers and an allowlist parser, for a logo. Registered as `brand:<id>` and `brand:<id>/<key>` and nameable as any contribution's `glyph`. |
| `node` | no | Relative path to the ESM entrypoint the node imports. Omit it for a client-only or descriptor-only plugin. |
| `client` | no | Relative path to the single client file. Omit it for a plugin that ships only descriptors and document surfaces — it then has no bytes to trust and no trust prompt. |
| `migrations` | no | Relative path to the Drizzle chain. |
| `$schema` | no | Editor schema URL. The loader does not fetch it. |
| `emits` | defaulted | Up to 32 event declarations. Each names a `verb` and a `description`; consumers subscribe to `plugin:<id>:<verb>`. |
| `requires` | defaulted | What this package needs from the rest of the node. One key, `plugins`: up to 16 entries of `{ id }`, each optionally with a `version` range. See below. |
| `permissions` | defaulted | See below. Omitting it means an empty declaration, not a full one. |
| `contributions` | defaulted | See below. |

### Requiring another plugin

If your plugin consumes another plugin's capability, say so:

```json
"requires": { "plugins": [{ "id": "agents" }, { "id": "workflows", "version": "2 || 3" }] }
```

The node checks the list once every package on disk has been read, so the order the directories sort
in does not matter. A requirement is met by anything present under that id: a built-in, another
installed package, or a client-only one. A package whose requirement is not met does not load, and its
roster row says which id was missing rather than which capability was absent. A package that was
dropped cannot satisfy anyone either, so a chain of dependants comes down with it.

`version` is a range over the required plugin's **major**, in the same grammar as `apiVersion`: `"2"`,
`"2 || 3"`, `"1-3"`. Majors are all a dependant can reason about unless the two packages share a
release process, and a built-in has no version to range over at all, so a range against one is
ignored.

Two things the list also buys. A plugin initializes after the ones it names, so a capability
registered in the provider's `init` is there by the time yours runs. And a package cannot require
itself or name the same id twice, both of which fail the manifest with a reason.

What it does not do is install anything. There is no resolver and no registry to fetch from, so the
owner installs both packages and this checks their work.

All three path fields go through the same `entry` refinement: no leading `/`, no `..` segment. The
loader then re-resolves each one inside the package directory with lexical **and** symlink
confinement (`resolveInRoot`), so a path that was hostile from the start is rejected at parse time and
one that becomes hostile through a symlink is rejected at load time.

### What the builder normally supplies, and you now supply yourself

`apps/node/scripts/build-plugin.mjs` generates the manifest from a plugin's
`acorn-plugin.config.mjs`, filling in six fields the config never states. Hand-written, they are
yours:

| Field | Builder's value | Hand-written value |
| --- | --- | --- |
| `id` | the plugin's directory name in `plugins/` | write it, and make it match the plugin's `name` in code |
| `version` | read from the plugin's `package.json` | write it |
| `apiVersion` | imported from `PLUGIN_API_MAJOR` | write the current major as a string, or a range covering it |
| `node` | `'./dist/node.js'` | your own relative path, e.g. `'./node/index.js'` |
| `client` | `'./dist/client.js'` when a client is declared | your own, e.g. `'./client.js'` |
| `migrations` | always `'./migrations'` in the built package | wherever your chain actually is |

Everything else in the generated manifest — `name`, `icon`, `icons`, `permissions`,
`contributions` — is copied through from the config untouched, so a `acorn-plugin.config.mjs` in the
repository is a faithful reference for what those blocks look like. `plugins/http/acorn-plugin.config.mjs`
is the widest one that owns tables; `plugins/model-providers/` is the narrowest (`contributions: {}`).

### Contributions

`contributions` is a loose object — a manifest written for a newer acorn contributes less on an older
one rather than failing to parse — with twenty-three named keys, each capped. The caps are not arbitrary:
each one is the point past which a contribution stops being an integration and starts being an app
inside someone else's chrome.

The rule that decides which key you want: **descriptors for facts, trees for UI, rectangles for
pixels.** Ask which of the three a surface is, in that order, and take the first that fits. A chip, a
badge, a menu row or a palette entry is a descriptor you declare and the host draws: it costs no
document, it looks native because it *is* the host's own components, and it stays live when nothing of
yours is mounted, because its data comes from a route on your always-running node half. A pane, a
panel body, a settings page or a card in somebody else's list is a tree. A frame is for pixels the
host cannot draw.

| Key | Cap | What it declares |
| --- | --- | --- |
| `frames` | 32 | A surface your client file draws: `pane` (task- or project-scoped), `refPanel`, `settings`, `importer`, `webview`, `overlay`, `coreSlot`. A `pane`, a `refPanel` and a `settings` surface **must** name a `layout` and its `regions`; a region is a tree (`{ "kind": "remote", "entry": "…" }`), a rectangle (`"frame"`), or a host-drawn document. This is also where a pane declares `claimsKeys` and up to eight cooperative `destinations`, and where a `coreSlot` surface names the core surface that it offers to replace. |
| `sources` | 8 | A rail source. Rows come from a route on your node half; the host draws them and executes the `onSelect` verb. |
| `slots` | 8 | A badge in an enumerated host slot: `footer` (the **task** footer, so it is invisible until a task is open) or `topbar` (the topbar's right end — the app's status bar). Nothing else is open, and `docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels` records why each refused slot is refused. |
| `palette` | 32 | The pre-`commands` spelling, still parsed as an alias for a command with `palette: true` and rewritten into one before anything else sees it. Prefer `commands`: this key takes the *full* verb union rather than the narrow one, which is a legacy inconsistency and not a capability worth reaching for, and it has only the `action` shape. |
| `commands` | 32 | A command, id-qualified by the host to `plugin.<id>.<command>`. Five shapes, on an optional `kind`: an `action` (the default, and one narrow verb), a `group` that holds children, a `search` naming a GET route and one static `onSelect`, an `input` naming a POST route and one static `onSuccess`, and a `setting` naming a read route, a write route and 2-32 labelled choices. A descriptor with no `kind` means exactly what it always did. `docs/plugins.md § Command kinds` has the fields and the bounds of each. |
| `keybindings` | 32 | A chord for a command from the same manifest. Canonical `meta+ctrl+alt+shift+key` order, must include `meta`, `ctrl` or `alt`, `when` is `global`/`task`/`surface`, and one binding per command. In the terminal client a terminal emulator keeps the command key for itself, so the host reads your `meta` as Ctrl: `meta+shift+p` is pressed there as Ctrl+Shift+P, and `meta+ctrl+alt+shift+d` as Ctrl+Option+Shift+D. You declare the chord once (`docs/tui.md` § What a plugin loses here). |
| `attention` | 4 | An attention-inbox feed, fetched per node from your route. |
| `nodeStats` | 4 | A node statistic, with a singular/plural label pair so a card reads "1 card stuck". |
| `contentLinks` | 16 | A bounded `https://` URL recogniser that delivers one captured segment to a task pane, your reference panel, or both. It must have at least one destination or the manifest is rejected. |
| `routes` | 8 | A renderer URL for a project-scoped pane, confined to `/p/:projectId/x/<id>/`. Eight, matching `sources`, because a route addresses something inside a surface a rail already reached. |
| `agentContexts` | 4 | An entry in the agent composer's context picker: an `options` GET and a `capture` POST. |
| `refResolvers` | 4 | A batch enrichment route so another plugin's surface can turn identifiers of your items into a label and a state chip. |
| `collections` | 8 | A typed set of records a user can compose a dashboard panel over: `{ id, name, items, params?, schema?, refresh? }`. `items` is a GET on your own namespace answering `{ schema, rows }`, in seven field types and five roles. The `schema` here is the *static* promise so an editor can offer views before any data exists; omit it and the response describes itself, at the cost of nothing being configurable until the collection has been read once. See `docs/dashboards.md`. |
| `themes` | 8 | A **colour** theme: `{ id, label, dark?, tokens }`, where `tokens` is the complete palette. You write no CSS — the host generates the block. See below. |
| `contextMenus` | 8 | A row on a host-drawn right-click menu: `{ id, location, label, icon?, order?, when?, action }`. `location` is from a closed list (`task.row` today); `when` is a map of literals that must all equal the target's facts; `action` takes the narrow verb set and receives the id of what was right-clicked. |
| `extensionPoints` | 4 | A place inside one of **your** surfaces that other plugins may fill: `{ id, label, kind, … }`. `kind` picks which of the five a point takes and which other fields it reads: `rows` and `annotation` take a `location` or a `key`, `remote` and `rectangle` take a `mode`, and `hook` takes a `payload` and an `allows` list. The host mints the id as `<yourId>:<pointId>`. You write no code for a `rows` or `annotation` point — the host draws it. |
| `schedules` | 4 | Work the node runs on a timer: `{ id, name, run, cadence, timeout? }`. `run` is a POST on your own namespace, called with `{ scheduleId }`, and its response is ignored beyond ok or error. `timeout` is seconds, defaulting to 60. The host mints the key from your plugin id, which is what opts the schedule into the 300-second plugin cadence floor. See `docs/schedules.md`. |
| `taskChecks` | 4 | What you have to say when the owner archives a task, and the cleanup you offer to do: `{ id, check, apply?, timeout? }`. `check` is a GET answering `{ concern }`; `apply` is a POST the archive runs if the owner leaves your checkbox ticked. See below. |
| `extensions` | 8 | What **you** bring to another plugin's point: `{ id, point, label, order?, … }`. `point` is `<ownerPluginId>:<pointId>`, and naming the owner out loud is the disclosure. Exactly one carrier says what you bring: `items` is a GET on your own namespace, for rows and annotations; `remote` is a key of the object your bundle passed to `mountTree`, for a tree; `frame` is an `inline` surface of yours, for a rectangle; `route` is a POST on your own namespace, for a hook handler. `matches` narrows a tree or a rectangle to the key values it draws, and `onSelect` takes the narrow verb set. |
| `auditActions` | 8 | A verb you write onto the node's audit trail: `{ id, label }`. The host qualifies it as `<yourId>:<id>` and refuses a `ctx.audit.record` naming one you did not declare, so the trail stays enumerable. Record what a person reviewing this machine would want to see, not every call you make. |
| `harnesses` | 4 | A managed agent acorn starts, drives and draws a transcript for: `{ id, label, glyph?, spawn, envPassthrough?, quirks?, probes?, terminal? }`. The only contribution that names a program acorn will run, and the only node-side one that needs no bundle at all. See [§ Harnesses](the-manifest.md#harnesses). |
| `agentTools` | 16 | A task-scoped agent tool projected through the ordinary registry: `{ id, description, inputSchema, risk, handler, scope?, requiresSession?, timeoutMs?, maxOutputBytes? }`. `handler` must be in your own `/v2/p/<id>/` namespace. The host qualifies the runtime name as `<pluginId>_<id>`, validates the bounded JSON Schema at install and validates every call again. See [Agent tools](../agent-tools.md#loaded-manifest-carriers). |
| `contextSections` | 8 | Bounded reference data for the task prompt: `{ id, label, order, read, maxBytes, maxTokens, scope?, defaultIncluded?, timeoutMs? }`. `read` must be in your own namespace and answers the fixed host-owned response shape. See [Agent tools](../agent-tools.md#loaded-manifest-carriers). |

A theme is the one contribution with no route and no bundle behind it, so it is the cheapest thing a
plugin can be. `tokens` must carry **exactly** the palette token names and nothing else: a missing one,
an unknown one, a derived one (`--danger`, `--surface-sunken` — those are `var()` references the host
declares once) or a style-axis one (`--radius`) all fail the parse. Values are a hex colour or a flat
colour function — `#1e1e2e`, `rgba(0, 0, 0, 0.42)`, `oklch(0.7 0.15 250)`; named colours, `var()` and
nested functions are refused. `dark: true` is how a theme says it is dark, and the host writes
`--is-dark` and `--color-scheme` from it — never try to set those two. The result is
selectable in Settings → Appearance as `plugin:<your-id>:<theme-id>`, and falls back to the built-in
default whenever your package is not there. **Call `plugin_authoring` for the current token list** — it
is read off this node's own schema, and getting one name wrong means the manifest does not parse.
Style packs (shape, density, typography) are not contributable; see `docs/ui-design.md`.

A `contextMenus` entry is the other contribution with a vocabulary you cannot guess at. `location` is
a closed list — **call `plugin_authoring` for the current one** — and a location this node does not
have is a parse error rather than a row that never appears. `when` is a map, not an expression: every
named fact must be strictly equal to the target's own, so `{ "origin": "github", "pinned": true }`
means both, and `{ "pinned": "true" }` matches nothing because a string is not a boolean. Naming a fact
the location does not supply is refused too, for the same reason as an unknown location. Your row lands
in the same menu core's rows come from, after them by default (order 500 against core's 10/20/30), and
its id is namespaced to `plugin:<your-id>:<row-id>` by the host so it cannot displace one of them.

The two cross-plugin keys are the third vocabulary you cannot guess at, and they are two halves of one
thing: `extensionPoints` is you opening a list to others, `extensions` is you filling somebody else's.
Both are manifest keys, both are shown in the trust prompt, and **there is no third way** — nothing lets
you touch a plugin that did not declare a point, and nothing lets your code run inside another plugin's
realm. What crosses is a descriptor: your `items` route answers
`{ items: [{ id, title, subtitle?, icon?, badge? }] }`, the host draws those rows with its own
components and stamps your plugin id beside them, and your one declared `onSelect` receives the clicked
row's id. A contribution to a point that is not there — owner not installed, disabled, or it dropped
the point in an update — delivers nothing, silently; that is the designed outcome, not a failure to
chase. **Call `plugin_authoring` for the current location list.**

A `coreSlot` frame is the related pattern for acorn's *own* surfaces:
`{ target: "coreSlot", id, label, coreSlot }` plus a client bundle, where `coreSlot` names one of the
designated surfaces (`rail.taskList` today). Declaring one **seizes nothing** — the user picks the
provider in Settings → Plugins, and acorn draws its own again the moment your plugin is disabled or your
surface throws. It is not a pane, so no verb can name it and it never appears in the pane switcher.

A `taskChecks` entry is the one contribution that runs when a person is about to lose something.
Archiving a task removes its worktree, so the host asks every plugin first and draws the answers in one
dialog. Your `check` route is called with `?taskId=`, and answers either `{ concern: null }` — the
common case, which must stay cheap — or:

```json
{ "concern": { "id": "containers", "severity": "warn",
               "message": "8 running containers are linked to this task",
               "details": ["api", "db", "worker"], "detailsMore": 5,
               "action": { "label": "Also stop its containers", "checked": true } } }
```

`details` is drawn as a list under the message, capped at five, with `detailsMore` counting what did
not fit so the host writes "+5 more" for you. `action` draws a checkbox, and if it is still ticked when
the owner confirms, the host POSTs `{ taskId }` to your `apply` — while the worktree still exists, so
a cleanup that needs it has it. Declare no `apply` and no checkbox is drawn, whatever your answer says:
that is the advisory mode, and it is the right one for anything you should not do on someone's behalf.

Three deadlines to write against. Your check has **two seconds**, because a person is watching a
dialog; your cleanup has sixty. Both `AbortSignal`s are a courtesy, not a leash — the host stops
waiting either way, so a check that wants to be included has to be quick rather than merely
interruptible. A check that is slow, throws, or answers with something the host cannot draw
contributes no row, exactly like one that found nothing; the archive is never blocked by your plugin
being broken.

Both routes are confined like every other, and both are shown in the trust prompt — the second line
says you offer to clean up, so a version that starts changing something where it used to only warn
reads as newly requested.

Every path in every descriptor is confined at parse time to `/v2/p/<id>/` — your own namespace and
nothing else. That check lives in `server/plugins/manifest.ts` rather than on the fields because it needs `id`,
and it is the parse-time twin of the runtime confinement the frame bridge applies.

The cross-field rules are worth knowing before you write a manifest that parses and then does nothing:
an `openPane` must name a task-scoped pane this manifest declares; a `navigate` must name a
project-scoped one; a project-scoped pane needs both a `routes` entry (its only address) and a source
whose `onSelect` navigates to it (its only mount site); an `overlay` needs an action that opens it; a
`surfaceAction` may name only a pane that draws a region of its own, as an iframe or as a worker
tree; a webview needs a client bundle; an
extension point must hang off a `pane` this manifest declares and only one may sit at each location on
it; an `extensions` entry's `point` must be a `<pluginId>:<pointId>` reference and its `items` route
must be your own; a `taskChecks` entry needs a `node` half, since only that serves the namespace its two
routes live in; a `harnesses` entry's `spawn` must name exactly one of `command` and `entry`, may only
carry `requires` beside an `entry`, and needs a `node` half if it declares any `probes`; a `coreSlot`
surface needs both a designated slot name and a client bundle; and no id may repeat across
contributions.

### Harnesses

A harness is a managed agent: acorn starts it, drives the session, and draws the transcript, the
permission prompts, the plans and the config options you see in the Agent pane. Every agent that
speaks the [Agent Client Protocol](https://agentclientprotocol.com) is one manifest away, because
acorn already owns everything downstream of the wire. That includes new-session defaults: whatever
config options your harness advertises are remembered and re-applied to the owner's next session with
no work on your side. For more information, see
[New-session defaults](../managed-agents.md#new-session-defaults).

This is the whole plugin that adds OpenCode:

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "version": "0.1.0",
  "apiVersion": "12",
  "icon": { "d": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" },
  "contributions": {
    "harnesses": [
      {
        "id": "opencode",
        "label": "OpenCode",
        "spawn": { "command": "opencode", "args": ["acp"] },
        "envPassthrough": ["OPENCODE_*"],
        "quirks": { "manualCompaction": true },
        "terminal": {
          "command": "opencode",
          "oneShot": { "args": ["run"], "modelFlag": "--model", "output": "text" }
        }
      }
    ]
  }
}
```

One manifest and one icon path. No node bundle, no client bundle, no build step, and no `exec` grant:
you describe a spawn, and the agents plugin owns the child process. Install it like any other package,
approve the two lines the trust prompt shows, and OpenCode appears beside Claude and Codex in the Agent
pane, in a task terminal, and in every Generate control in acorn.

The runtime id is `opencode:opencode`: the host prefixes your harness id with your plugin id, the same
minting rule extension points follow, and for the same reason — a manifest may not claim a name in
someone else's space. That id is persisted into session rows and workflow steps, so renaming it is a
compatibility break for your users rather than a label edit.

**What you declare, and what acorn does.**

| You declare | acorn does |
| --- | --- |
| `spawn` | Starts the agent, owns the child, and restarts and shuts it down in the documented order |
| `envPassthrough` | Builds the child environment through the broker contract; credentials never pass through |
| `label`, `glyph` | Every surface: Agent Center rows, the pane header, usage sections, notifications |
| `quirks` | Enables or hides the matching affordance, per harness |
| `terminal` | Registers the terminal profile: task terminals, handoff, the input-controller lease |
| `terminal.oneShot` | Lists your agent in every Generate control, and runs one contained turn when it is picked |
| `probes` | Fetches them and draws the answers |
| nothing else | The ACP connection, the normalizer, the durable event ledger, transcript rendering, permission plumbing, attachments, session persistence, reconnect, replay |

If you find yourself writing code to add a harness, either the agent does not speak ACP — in which
case this contract does not cover it — or the seam has a gap, which is a bug report.

**The two spawn forms.** `spawn` takes exactly one of:

- **`command`** — an executable on `PATH`, with `args`. The common case: `opencode acp`,
  `gemini --experimental-acp`. The user installs the CLI; your harness's diagnostics say so when it is
  missing.
- **`entry`** — a package-relative JavaScript file, run with the node service's own binary. This is
  how you ship an adapter for an agent that does not speak ACP natively, the same way acorn's own
  Claude harness runs a packaged adapter. Add `requires: { command, env }` and acorn resolves that CLI
  on `PATH` and hands the child its absolute path under the variable you named — which is what an
  adapter needs and the reason there is no template language here.

An `entry` is your code running in a child process. Less privileged than a node bundle, since it is
not inside the node, but still code, and the trust prompt says so.

The ACP project publishes a registry of each agent's launch arguments at
`cdn.agentclientprotocol.com/registry/v1/latest`. Copy yours from there. acorn never fetches it at
runtime: your manifest is the pinned truth, so launch arguments change by plugin update and the trust
record sees it.

**Quirks.** ACP does not carry everything every vendor can do, and the gap is closed by declaration
rather than by a list of ids inside acorn:

- `manualCompaction` — the agent implements a compaction command, so the pane offers Compact.
- `sessionPersistence` — sessions outlive the agent process and can be reloaded, so resume and the
  terminal handoff exist.

Do not restate anything the agent already says through ACP capability negotiation. The driver reads
those off the wire, and a manifest repeating them would only drift.

**Probes.** Two optional GETs on your own node half, which means adding a `node` entry:

- `probes.usage` answers `{ plan?, quotas: [{ id, label, percentRemaining, resetsAt?, resetText? }], account? }`.
  Use `session` as a quota id for the one the compact indicator shows. acorn derives the health and the
  capture time, so one harness cannot call 5% remaining healthy while another calls it critical. Without
  this route your harness simply shows no usage section, which is the right answer for most agent CLIs.
- `probes.auth` answers `{ authenticated: boolean | null, diagnostic? }`, for the Agent Center's
  provider-health row. `null` means "cannot tell", which is different from `false`; an answer acorn
  cannot read is treated as `null` rather than as signed out.

**One-shot text generation.** `terminal.oneShot` describes how your CLI answers a single prompt and
exits. Declare it and your agent appears in every Generate control in acorn — the commit message wand,
the SQL draft, the workflow definition generator — beside whatever API keys the owner has connected.
Three fields:

- `args` (required) — the subcommand and switches for one prompt in, one answer out. `["run"]` for
  OpenCode.
- `modelFlag` — the flag a model id goes behind, in your CLI's own spelling. OpenCode wants
  `--model` and reads `provider/model`. Leave it out and your CLI answers on whatever model it is
  configured with.
- `output` (required) — `text` if your CLI prints the answer on stdout, `json-lines` if it writes a
  newline-delimited stream with a `result` event in it, which is the shape
  `claude -p --output-format stream-json` writes. There is no default: guess wrong and every generate
  fails as unreadable output.

acorn builds the argv in fixed positions: your `args`, then `modelFlag` and the model when a caller
names one, then the prompt last. A system prompt is prepended to that prompt with a blank line between,
because a manifest has no way to name a system-prompt flag.

That is the whole language, and it stays that way. There are no placeholders, no `${prompt}`, and no
per-argument conditions, because a manifest that can say "if resuming, add these two arguments" is a
template language nobody can hold in their head. A CLI that wants the prompt in the middle, or a flag
whose value depends on another flag, needs a code-tier profile instead.

Two things to check before you pick `output`. Run your CLI with its stdout on a pipe rather than a
terminal, because plenty of them print differently to each: `opencode run` sends its `> agent · model`
header, tool lines and permission prompts to stderr and only the assistant's text to stdout, which is
what makes `text` right for it. Then look for a terminating event if you were reaching for
`json-lines`: `opencode run --format json` emits `step_start`, `text`, `tool_use` and `step_finish`
lines with no `result` among them, so acorn would read the answer as missing.

The generate runs contained, and none of it is yours to arrange: an empty temporary directory, so your
CLI does not read a repository's `AGENTS.md` in front of the caller's prompt; no acorn token and no MCP
server in the child, so there is nothing for a tool to call; a 60-second ceiling; and an environment
with no key acorn holds anywhere in it, so your CLI authenticates with its own stored login. The trust
prompt names the invocation on its own line, because it is a second program run with different
arguments: "Runs `opencode run --model MODEL` to generate text". Change those arguments in a later
version and the owner is asked again.

**What a data-only harness does not get.** Headless and agentic workflow steps. Turning conditional
argv assembly into manifest data means inventing an argv template language, and that is the flexibility
this contract refuses in favour of something a person can hold in their head. A data-only harness works
in the Agent pane, the terminal and the Generate lists; a workflow's agent step cannot name it. A
workflow `decide` step can, but it needs a JSON verdict back and a manifest cannot ask your CLI for
one, so a `text` harness will answer prose and the step will fail. A harness that needs either is asking
for first-party investment, not a bigger manifest.

### The action verbs

Descriptors do not run plugin code. They hand the host a verb from a closed set, and the host executes
it. Closed is the point: every plugin composes the same few verbs, and adding one later is additive
where removing one would not be.

The full set. It is meant for a rail source's `onSelect` — the one click site that has a selected row,
a routed project and the host's promotion callback in scope. A `search` command's `onSelect` gets the
narrow set plus `navigate`, because it has both halves of a project-surface address too. (The legacy
`palette` descriptor also accepts the full set, which predates the split and should not be relied on.)

| Verb | Effect |
| --- | --- |
| `openPane` | Push a task-scoped pane from this manifest into the active task's layout, carrying the clicked row's id as a pane intent. |
| `openTask` | Go to the task the row names, and stop. For a row whose subject *is* a task, where picking a pane on the reader's behalf would be `openPane` wearing another name. A row that names no task gets a toast saying so. |
| `navigate` | Change the URL to the route this manifest declared for a project-scoped pane, with the selected row as the addressed item. |
| `runNodeAction` | POST to a path inside `/v2/p/<id>/`. |
| `createTask` | Host-owned promotion: the row supplies the task seed, the host owns the modal, the ownership check and the ordering. |
| `openUrl` | `https` only, in the real browser. |
| `openOverlay` | Open a full-screen picker this manifest declares. |
| `surfaceAction` | Deliver this command's own id to a region of one of your own panes — an iframe or a worker tree. The only verb whose effect lands inside a plugin. |

Commands, slot badges and a source's `emptyState` take a **six-verb subset**: `openPane`, `openTask`,
`runNodeAction`, `openUrl`, `openOverlay`, `surfaceAction`. `createTask` and `navigate` are absent
because they need a selected row and a routed project respectively, and a command registry row has
neither. A verb that parses and can then only fail is worse for an author than one the manifest
refuses.

### Permissions

Three groups, enforced at the boundary that owns each one.

`permissions.node` shapes both the RPC `ctx` your node half receives
(`server/plugins/permissions.ts`) and its permission-scoped worker realm. Gating is by omission: an
undeclared host facet is absent, so the first call is a `TypeError` the author sees immediately.
Filesystem, environment, process, and network grants are also absent unless declared.

- `core`: `fs`, `git`, `tasks`, `context`, `models`, `identity`, `prefs`, `telemetry`, plus
  `projects:read`, `projects:config`, `projects:write`. The project grants nest — `config` and
  `write` each imply `read` — and they are split because `checkouts()` returns where every codebase
  on the machine lives, and `config()` returns shell commands the node executes. An unknown token is
  skipped, not rejected: a manifest naming a facet from a newer build should lose that one grant.
- `capabilities`: capability ids this plugin may `get`/`require`. `provide` is never filtered —
  exporting a capability is a contribution, not an access grant.
- `secrets` / `exec`: booleans, separate from `core` because they are the two asks a reviewer should
  have to see spelled out.
- `net`: exact hostnames the worker's `fetch` may reach. Raw network modules stay unavailable,
  and redirects are returned rather than followed so fetching the next location rechecks its host.
- `env`: parent-environment variable names the worker may inherit in addition to the process broker's
  credential-free base. Each is a high-risk trust line.
- `files`: local path grants resolved from environment variables, as
  `{ "env": "MY_PLUGIN_FILE", "access": "read" | "read-write" }`. The value must be absolute and
  outside acorn's data root. A read-write grant includes one fixed `.acorn-tmp` sidecar so an author
  can replace the file atomically without receiving its whole directory.

**`telemetry` is the one grant that hands you other packages' data.** It gives you
`ctx.core.telemetry.onBatch`, and a sink sees every record this node collects from every owner:
core's request timings, another plugin's schedule and hook runs, and the log lines of packages the
owner installed for a different reason. The trust prompt says exactly that, and draws it high:
"Read this node's telemetry: request timings, schedule and hook runs, logs, and error names from
every plugin". Writing telemetry about your own work needs nothing (§ Telemetry and logging).

```json
{ "permissions": { "node": { "core": ["telemetry"] } } }
```

```js
export function init(ctx) {
  ctx.core.telemetry.onBatch((batch) => queue.push(batch))
}
```

Return quickly. The collector calls sinks on a timer, awaits none of them and contains a throw, so
buffering, retry and sampling are yours ([telemetry.md](../telemetry.md) § Writing a sink).

A telemetry sink can check `ctx.core.telemetry.enabled()` before retrying a queued export. It reports
the collector’s node consent, updated within five seconds, and needs the same `telemetry` permission
as `onBatch`. Do not read `telemetry.enabled` through `ctx.core.prefs`: those keys are scoped to the
plugin’s own namespace.

**`models` is one token, and it does not choose what gets spent.** The trust prompt reads "Generate
text with your model providers and installed agent CLIs", because the list your picker draws holds
both: a connected OpenAI or Anthropic key, and any agent CLI on the machine that declares a one-shot
text mode ([integrations.md](../integrations.md) § Model providers). Which of them runs is decided by
the person picking from the dropdown, or by your own fallback to the first available backend. You
cannot name a CLI the owner does not have, and you cannot make one run with tools or inside a
worktree, because core owns that process. There is no second token for the CLI half: `models` is the
host operation being granted, whichever host-owned backend the person later chooses.

`permissions.api` is the **frame's** scope list, and unlike the node block it is genuinely enforced —
by an allowlist of (path shape, method) pairs at
`packages/client-core/src/host/frames/scopes.ts`, which is the choke point for everything a
sandboxed frame can reach. Your own `/v2/p/<id>` namespace needs no scope and is always allowed.
Another plugin's namespace is always denied. Everything else needs one of six scopes:

```
core.projects:config   core.projects:read   core.projects:write
core.tasks:read        core.tasks:write     core.workspaces:read
```

That is the whole grantable vocabulary (`GRANTABLE_SCOPES`, derived from the table rather than copied
beside it). Much of core is listed in the table with no mapping at all and can never be granted
whatever a manifest declares — the plugin install route above all, because a frame that could reach it
would install unsandboxed code and make every other line moot.

`permissions.events` names channels the frame may subscribe to. Subscribing does not create a channel,
and there are two kinds to name:

- **Five of the shell's own**, listed in `client-core/host/frames/channels.ts`. Four say that
  something a frame may be showing has gone or moved: `runtime:task-archived`,
  `runtime:workspace-removed`, `runtime:node-removed`, `runtime:node-switched`. The fifth,
  `runtime:focus-changed`, says which pane and region of this window the keyboard is in, as
  `{ taskId, paneId, regionId }`. All five are about one window, so a node never broadcasts one and a
  second window never sees yours.
- **Another plugin's live channel**, `plugin:<other-id>:<verb>`, when that plugin lists the verb in
  its manifest's top-level `emits` array. If it is not installed you hear nothing and get no error, so
  treat the frame as "go re-read" and never as the only way you learn something.
- **Your own live channel**, `plugin:<your-id>:<verb>`, which your node half broadcasts on with
  `ctx.events.send({ channel, ...payload })` and which core routes to whichever of your frames
  subscribed. Both halves are lowercase, start with a letter, and hold no colon. Another plugin's
  undeclared verbs are refused, exactly as its routes are.

That last one is how a frame gets live data without polling, and it also nudges your own descriptors
— badges, rail rows — so they update faster than the 30-second floor a declared `refresh` allows. See
[plugins.md § The live channel](../plugins.md) for the cadence rules and what a push does *not* reach.
