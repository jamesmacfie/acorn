# Skills

A skill is a named procedure an agent loads when a task calls for it. A loaded plugin supplies it as
a folder. Claude Code and Codex load it with their own skill support, so a person can call it from the
composer. Every other harness gets its name, its description, and where its body is. Either way the
agent reads the body only when a task matches, so ten skills cost ten lines of context, not ten bodies.

Always-on instructions stay [context sections](../agent-tools/context-sections.md). A skill is for a
procedure the agent should find, not one it should always carry.

## Skills

### The shape

A skill is a folder holding a `SKILL.md`: YAML frontmatter with `name` and `description`, then a
Markdown body, with supporting files beside it. It's the shape Claude Code reads from `.claude/skills/`,
with nothing added, so a skill written for Claude Code drops into a package unchanged.

```json
{
  "contributions": {
    "skills": [
      { "id": "release-note", "path": "skills/release-note" }
    ]
  }
}
```

A plugin declares up to 16. The host names each `<pluginId>:<id>`. A package with only skills needs no
Node or client bundle. The loader runs it as a plugin with an empty `init`, the way it runs a
data-only harness, so it gets a row in **Settings > Plugins** and can be turned off. The standalone
example is the `acorn-skills` plugin, kept in its own repository.

### The checks

`server/plugins/skills.ts` in node-core reads each skill at install, at every load, and at every
session start. It refuses a skill with a named reason, and a refused skill fails its package:

- The folder must resolve inside the package, with no traversal and no symlink out of it.
- The folder may hold no symlinks at all, so every file an agent is pointed at is a file that was
  hashed. It's capped at 64 entries, 4 levels, and 1 MiB.
- `SKILL.md` must be UTF-8 and start with frontmatter between `---` lines.
- `name` is up to 64 lower-case letters, digits, and dashes. `description` is up to 1,024 characters
  with no XML tags and no control characters. These are
  [Anthropic's published rules](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure).
  Other frontmatter keys are allowed and ignored.
- The body after the frontmatter is at most 64 KiB, with no NUL.
- Two skills in one manifest can't share an `id`.

The frontmatter reader understands plain, quoted, and `|` or `>` block strings for `name` and
`description`. It isn't a YAML parser, and it refuses a form it can't read rather than guessing.

Each skill has a digest: a sha256 over every file in its folder, by relative path. The owner approves
that value, and it's how acorn notices a change.

### Approval

The device trust hash covers only a client bundle, so a skills-only package never reaches the bundle
prompt. Skills are approved on the Node instead, the way [derived-source
inputs](../data-sources/derived-sources.md) are. The plugin's roster row carries `skills`: each skill's
name, frontmatter title and description, digest, and whether it's approved and switched on. Any
unapproved skill puts a request in the trust prompt on both hosts. Its line sits under **Declared** and
isn't marked high: "Adds 2 procedures your agents can load: migrate, review". The line's key holds
every digest, so a version that changes one byte of a body is marked as new and asks again.

Accepting posts `POST /v1/core/plugins/:id/skill-grant` with the digests shown. The Node refuses it
with 409 if those aren't the digests the running plugin has. Rejecting turns the plugin off on that
Node. The terminal client answers a skills request itself, unless the same plugin also waits on input
approval, which stays in the desktop app.

The Node keeps both answers in `skill-state.json` in its data root: `approved` maps a skill name to the
approved digest, and `disabled` lists the skills switched off. Uninstalling forgets both. An update
keeps them, so the switch survives and a changed body asks again.

The optional [instruction review](../security.md#instruction-file-checks-and-review) also includes
delivered skill bodies and supporting scripts in a project's pre-turn snapshot. Its approval is
separate from this plugin skill grant: neither approval substitutes for the other.

### The catalogue

The catalogue is `server/pluginHost/skills.ts` in node-core. The host fills it from each active loaded
plugin through `ctx.skills.register`, a host-only member like `ctx.harnesses`, and takes the entries
back on disable, reload, or a contained failure. It holds what the running version loaded. An update
that's installed but not started isn't presented as the running plugin's content.

The agents plugin reads it through two functions on the compiled-only facade,
`@acorn/plugin-api/node`:

- `deliverableSkills(dataDir)` returns every skill that's switched on, approved at its current digest,
  and whose folder still holds those bytes. It hashes each folder again, so a package edited under a
  running Node stops being offered. It's sorted by name, so two starts with the same answers send the
  same index.
- `recordSkillDelivery(harness, { delivered, omitted })` records what the first turn after a start
  carried.

Loaded plugins can't reach either. A loaded bundle that imported them would get its own empty copy.

### Delivery

`ProviderSessionLifecycle.start` reads the deliverable skills at every provider start and resume, the
same moment it resolves the session's MCP servers, and plans them with `prepareSkillStart` in
`server/drivers/skillIndex.ts` in the agents plugin. A driver with its own skill support gets every
skill natively ([native skills](./native-skills.md)). Any skill that harness hasn't listed by the first
turn, and every skill on any other harness, goes in the index:

```
These are procedures you can load. Read the file when a task matches the description.

- pi-skills:release-note: Write a release note entry for a change in this repository. ... (/…/SKILL.md)
```

The sentence is acorn's. The names, descriptions, and paths are data. The index is capped at 16 KiB.
A skill that doesn't fit is left out whole, the index says how many were left out, and settings names
them. Bodies are never sent.

The lifecycle sends the index as an `<acorn-context source="context.skills">` part ahead of the first
turn after each start, on every harness. It isn't added to the turn row, so the person's message stays
theirs. It doesn't go in a system prompt, because Claude Code 2.1.292 keeps the appended prompt a
session was created with: a resumed session ignores a new one, so a skill switched off would stay. It's
kept apart from standing context too, which is a snapshot taken when the session was created.

A skill the agent was told about before and that's gone now is named in the same part: "These procedures
were removed and can't be loaded now, even if an earlier list in this conversation names them:
acorn-pi-skills:release-note." That holds for a native skill too, because neither Claude Code nor Codex
tells the model on a resume that a skill went away, and the old listing stays in the conversation. The
session row keeps the names the last delivery told the agent, native names first, in
`config.skillIndex`, a key only the Node writes. A digest written there by phase 06's build is read as
no names.

| Harness | Delivery | Body readable through |
| --- | --- | --- |
| Claude Code 2.1.292 | Native: session plugins | A read-only allow rule per skill folder, `Read(//<folder>/**)`, in the SDK flag settings. Flag settings are per process, so the rule follows the current start on a resume |
| Codex 0.159.2 | Native: extra skill roots | Codex's built-in permission profiles read the whole disk. A custom profile that limits reads makes Codex ask |
| DeepSeek, `omp`, other ACP | The index. ACP has no skill API | The harness's own tools and permission prompts. `omp`'s native `read` asks no permission |

Nothing writes into the worktree, and no harness is granted the data root or any write access. On a
harness without native support there's no staging copy: the agent reads the installed package's
folder, which the digest check guards.

A delivery counts once the first turn after a start has run. Then the catalogue records which harness
received which skills and whether natively, and the transcript gets one line, such as "Skills the
agent can load: acorn-pi-skills:release-note (native)." or "The agent was told these are gone:
acorn-pi-skills:release-note." If that turn fails, the part is owed again on the next turn of the same
process, worked out afresh from what the harness has listed by then. A process that keeps running keeps the index
it started with, and never reads as refreshed. Switching a skill off, approving one, or updating a
package applies at each session's next start or resume, never in the middle of a turn.

A compaction can drop the index from a long session's context, as it can drop a custom agent's
instructions on a harness with no system prompt. The next start sends it again.

Claude Code and Codex load skills with their own skill support instead of the index. See
[native skills](./native-skills.md).

### Settings

**Settings > Plugins > {plugin} > Overview** shows a **Skills** section for a plugin whose running
version has skills. Each skill has a switch, its description, and two lines kept apart:

- Its status, which says whether the next start may receive it: ready, off, waiting for approval, or
  changed on disk.
- Which harnesses received it, how, and when, since the Node started: "Loaded natively by Claude Code
  at 04:15 PM", "Reached DeepSeek through acorn's list", or left out of a full list.

`GET /v1/core/plugins/:id/skills` returns `PluginSkillState`. `PUT` with `{ name, enabled }` sets one
switch. Both are device-only and can't be reached from a plugin frame. The section reads the active
Node through its query cache, key `['plugin-skills', 'v1', id]`, and is hidden when the page names
another Node, so one Node's paths and deliveries are never shown as another's. The terminal client
opens plugin pages in the desktop app.

## Related

- [Custom agents](./custom-agents.md): the other way a plugin puts its words in front of an agent.
- [Harnesses](./harnesses.md): the drivers that receive the index.
- [Phase 06](https://github.com/jamesmacfie/acorn/blob/e67db6f50/docs/future/pi/06-portable-skills.md) and [phase 07](https://github.com/jamesmacfie/acorn/blob/e67db6f50/docs/future/pi/07-native-skills.md): the
  portable delivery here, and native delivery through Claude Code's and Codex's own skill support.
