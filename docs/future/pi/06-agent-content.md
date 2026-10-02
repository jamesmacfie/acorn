# 06. Skills a plugin ships, delivered to every harness

Status: proposed, 2026-10-02. Not started.

## Why

An `omp` plugin is a folder that can hold skills, slash commands, rules, prompts, subagent
definitions, MCP servers, and language-server setups, in a format shared with Claude Code's plugin
marketplace. Most useful plugins in that ecosystem are content, not code: a review checklist, a
migration procedure, a house style. They are text an agent reads when the task calls for it.

An acorn plugin can contribute instructions three ways: a custom agent's system prompt text, a context
section, and an agent context in the launch tray. All three put text in front of the agent up front.
None of them is a skill: a named procedure the agent sees only by name and description until it
decides to load the body. That difference matters at scale. Ten skills cost ten lines of context; ten
context sections cost their whole bodies on every session.

Acorn already reads skills from harnesses. Codex's `skills/list` fills `AgentSkillDescriptor` in
`plugins/agents/src/contract/wire.ts`, and the composer offers them after `$`
([client surfaces](../../managed-agents/client-surfaces.md)). What acorn cannot do is supply one.

This is also where acorn can beat `omp`. An `omp` skill reaches `omp`. An acorn skill could reach
Claude, Codex, DeepSeek, `omp`, and any contributed harness from one manifest, the way an MCP server
added in Settings reaches all of them.

## What a skill is

A folder holding a `SKILL.md` file: YAML frontmatter with `name` and `description`, then a Markdown
body, with optional supporting files beside it. Claude Code reads this shape from `.claude/skills/`,
and Codex reads a compatible one. Use the shape as published, with no acorn additions, so a skill
written for Claude Code drops into an acorn plugin unchanged.

## The design

### The manifest

```json
{
  "contributions": {
    "skills": [
      { "id": "review-checklist", "path": "skills/review-checklist" }
    ]
  }
}
```

The host resolves `path` inside the contributing package, the same way it resolves a harness's
`spawn.entry`, and refuses a path that leaves the package. It reads `SKILL.md`, checks the frontmatter,
caps the description at 1,024 characters and the body at 64 KiB, and refuses the contribution with a
named reason when either fails. The skill's runtime name is `<pluginId>:<id>`, minted by the host.

No node or client bundle is needed. A skills-only plugin is a manifest and folders, like a data-only
harness.

### Delivery, in two layers

**Layer 1, every harness: an index plus a readable path.** This is how skills already work inside
Claude Code: the agent sees each skill's name and description, and reads the body when it needs it.
Acorn can do the same for any harness without the harness knowing what a skill is.

- Add one context section owned by the agents plugin, `skills`, that lists each enabled skill as name,
  description, and the absolute path of its `SKILL.md` in the installed package.
- Add one sentence above the list: "These are procedures you can load. Read the file when a task
  matches the description."
- Deliver it on every start and resume, the same rule MCP servers follow, so enabling or disabling a
  plugin takes effect on the next resume.

The path has to be readable by the agent. The installed package sits under acorn's data root, outside
the worktree. Check each harness: Claude Code may ask before reading outside its working directories,
which the Agent SDK's additional-directories option can grant for that one folder; Codex's sandbox
policy decides for Codex. A harness that cannot read the path gets no index, and the skill's settings
row says which harnesses received it.

**Layer 2, where a harness has a native door.** Native delivery gives the person `$skill` and `/skill`
in the composer and lets the harness's own skill tool load it.

- **Claude Code.** The Agent SDK accepts local plugin folders. Acorn already passes SDK options through
  `_meta.claudeCode.options` in `plugins/agents/src/server/drivers/claudeHarness.ts`. Generate one
  plugin folder per session under the data root holding the enabled skills, and pass it there. Never
  write into the worktree's `.claude/skills`, which would show up in the person's git status.
- **Codex.** Find whether the app-server takes extra skill roots on `thread/start`, or a config key
  that does. If the only door is `CODEX_HOME`, do not use it: moving it moves Codex's login.
- **Generic ACP.** No protocol door. Layer 1 covers them.

When a harness receives a skill natively, leave it out of that session's layer 1 index so the agent
does not see it twice.

### Trust

A skill is text that tells an agent what to do, so it is a prompt-injection path by design. Disclose it
in the trust prompt as a medium line: "Adds 3 procedures your agents can load", with the names. The
bytes are already covered by the bundle hash the device checks, so an update that changes a skill's
body asks again like any other change.

### Settings

**Settings > Plugins > {plugin}** lists the plugin's skills, each with a switch and the harnesses it
reached. Disabling one removes it at the next start or resume.

## What this leaves out, and why

- **Rules.** `omp` rules can apply by file glob or interrupt a stream. A glob-scoped rule needs the
  harness to tell acorn which file it is about to edit, and stream rules need the loop. An always-on
  rule is a context section, which a plugin can contribute today.
- **Slash commands.** Claude Code treats a command as a skill with a slash name. Layer 2 gives Claude
  commands for free. A command for every harness would be a composer feature that expands a template
  before sending, which `agents:before-send` with `transform` can already do.
- **Subagent definitions.** These are custom agents, which a plugin can contribute today
  ([managed-agents.md § From a plugin](../../managed-agents.md#from-a-plugin)).
- **Hooks.** Claude Code plugin hooks run shell commands inside Claude only. They are code, and they
  belong to the harness's trust model, not acorn's.

## Later: Claude Code plugin folders

Most published skills ship inside Claude Code plugin folders: `.claude-plugin/plugin.json` beside
`skills/`, `commands/`, `agents/`, and `.mcp.json`. Once this file ships, an importer could install
such a folder as an acorn content plugin: skills as skills, agents as custom agents, `.mcp.json`
entries as MCP servers, and hooks refused with a visible reason. Discovery from a marketplace catalog
belongs to [ecosystem](../ecosystem/README.md), which waits on signing.

Trigger: a person asks to use a published Claude Code plugin in Codex or another harness. In Claude
sessions it already works, because Claude loads its own plugins.

## Steps

1. Add `contributions.skills` to the manifest contract and schema, with the path and size checks.
2. Build layer 1: the `skills` context section, delivery on start and resume, and the per-harness
   readability check. Test that a disabled plugin's skill leaves the next resume's index.
3. Build layer 2 for Claude Code. Confirm the SDK option in a live session and that `$` lists the skill.
4. Investigate Codex's door and record the answer in this file before building it.
5. Add the trust line and the settings rows.
6. Prove it with one skills-only plugin outside the repository.
7. Document in [the manifest](../../plugin-authoring/the-manifest.md), [contribution
   kinds](../../contribution-kinds.md), and [managed-agents.md](../../managed-agents.md).

## Verify before building

- The Agent SDK's option name for local plugin folders and additional readable directories, and that
  the Claude ACP adapter passes `_meta.claudeCode.options` through for both.
- Codex's skill roots and whether `skills/list` takes anything beyond `cwds`.
- How MCP servers are delivered on start and resume in `plugins/agents/src/server/sessions/runtimeEngine.ts`,
  to reuse the same path for the index.
- The current `SKILL.md` frontmatter rules, from Anthropic's documentation rather than from memory.
