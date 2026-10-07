# Release note skill

A skills-only acorn plugin: a manifest and one skill folder, with no Node or client bundle. It's the
consumer for [skills](../../../../managed-agents/skills.md), built for
[phase 06](../../06-portable-skills.md).

## What it does

It gives every managed session one procedure, `pi-skills:release-note`. The agent sees its name and
description at every start and resume. When asked for a release note, it reads `SKILL.md`, which tells
it to follow `format.md`. The format ends with a fixed line, `Formatted with the pi-skills release-note
procedure.`, so a transcript shows whether the agent read the supporting file and not only the body.

## Files

- `acorn-plugin.json` declares `contributions.skills` with one entry.
- `skills/release-note/SKILL.md` is the procedure, in the standard shape: `name` and `description`
  frontmatter, then the body.
- `skills/release-note/format.md` is the supporting file the body points to.

## Install

There's no build step. Post the folder to the Node, then restart it:

```sh
curl -X POST "$NODE/v1/core/plugins/install" \
  -H 'content-type: application/json' -H 'idempotency-key: pi-skills-1' \
  -d '{ "source": { "path": "<checkout>/docs/future/pi/packages/skills" } }'
```

Or use **Settings > Plugins > Install…**. After the restart the trust prompt asks: "Adds 1 procedure
your agents can load: release-note". Accept it, then start or resume an agent session and ask for a
release note for the working tree. **Settings > Plugins > Release note skill** shows the switch and
which harnesses received the skill.

Editing a file in the folder changes the skill's digest. The plugin's page then says the skill changed
on disk, and agents don't get it until the plugin is reloaded or the Node restarts and the owner
approves it again.
