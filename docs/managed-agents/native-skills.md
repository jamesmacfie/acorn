# Native skills

Claude Code and Codex have their own skill support, so acorn hands them a plugin's skills as real
skills rather than as [the index](./skills.md#delivery). The person can then call one from the
composer, and the harness's own skill tool loads it.

## Native skills

A driver that sets `nativeSkills` gets a copy of every deliverable skill for each start, in
`<data root>/agent-skills/<session id>/<generation>/`, written by `server/drivers/skillFolder.ts`. Each
contributing plugin gets a Claude Code plugin folder there: `.claude-plugin/plugin.json` named
`acorn-<pluginId>`, beside `skills/<id>/` holding every file of the skill. The copy's frontmatter `name`
is rewritten to the skill's id, and nothing else changes.

- **Claude Code** gets each plugin folder through the Agent SDK's `plugins` option, inside
  `_meta.claudeCode.options`. Adapter 0.54.1 spreads those options into the SDK unchanged on a create
  and a resume alike, and SDK 0.3.197 turns each one into `--plugin-dir`. Unlike the appended system
  prompt, a resumed session loads the plugins it's given now. Claude Code names a plugin skill
  `<plugin name>:<folder name>`.
- **Codex** gets each `skills/` folder through `skills/extraRoots/set`, sent once per app-server
  process after `initialize` and before `thread/start` or `thread/resume`. Codex holds the roots in
  memory and writes nothing to its config, so the person's own skills, `CODEX_HOME`, and login are
  untouched. Codex names a skill under a plugin manifest `<plugin name>:<frontmatter name>`.

Both harnesses therefore call a skill `acorn-<pluginId>:<id>`, which maps back to the canonical
`<pluginId>:<id>` by dropping `acorn-`. The prefix matters: Claude Code replaces an installed plugin with
a session plugin of the same name, so a plugin named after one of the person's own would hide it. Two
plugins that both have a `review` skill land in different folders under different names.

A skill leaves the index only once the harness has advertised its native name: Claude Code in the
`available_commands_update` it sends after a session is created or resumed, Codex in `skills/list`. The
lifecycle notes every name a start's events advertise, and an event from a retired start counts for
nothing. A skill the harness hasn't listed by the first turn goes in the index, pointing at the copy, so
a failed native load still reaches the agent. A folder that can't be written puts every skill in the
index at its installed path, and the transcript says why.

The copy is written once and never changed, so a package updated under a running process can't change
what it reads. The lifecycle removes it once that process stops: on idle stop, archive, replacement,
a failed start, or shutdown. A Node that died leaves its copies behind, and the agents plugin's boot
pass removes any that no live session is using.

The person calls a native skill with the harness's own syntax, which the composer offers because the
harness listed it: `/acorn-pi-skills:release-note` in Claude Code and `$acorn-pi-skills:release-note` in
Codex. Acorn adds no slash-command expansion of its own, and the index offers no composer choice.

## Related

- [Skills](./skills.md): the shape, the checks, approval, the catalogue, and the index.
- [The composer](./composer.md): where the harness's commands and skills are offered.
- [Phase 07](../future/pi/07-native-skills.md): the evidence behind each harness's door.
