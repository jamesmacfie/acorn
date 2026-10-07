# Phase 07: native skill delivery

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phase 06 accepted with
the portable delivery catalogue. Next: [phase 08](./08-resource-read-experiment.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-07-native-skills`, at the commit titled "Phase 07: Native skill
delivery". [Native skills](../../managed-agents/native-skills.md) is the owning contract, and
[skills](../../managed-agents/skills.md) keeps the index.

- **Both doors are native.** Claude Code and Codex each load a per-start copy of every deliverable skill
  with their own skill support. DeepSeek, `omp`, and other ACP harnesses keep phase 06's index.
- **The copy.** `plugins/agents/src/server/drivers/skillFolder.ts` writes
  `<data root>/agent-skills/<session id>/<generation>/`. Each contributing plugin gets
  `.claude-plugin/plugin.json` named `acorn-<pluginId>`, beside `skills/<id>/` with every file of the
  skill. The copy's frontmatter `name` is rewritten to the id and nothing else changes.
- **Claude.** `claudeHarness` sets `nativeSkills` and passes each plugin folder as
  `_meta.claudeCode.options.plugins: [{ type: 'local', path }]`. `acpSessionMeta` takes
  `{ folders, plugins }` in place of the folder list.
- **Codex.** `CodexAgentDriver.nativeSkills` is true. `codexStart.ts` sends `skills/extraRoots/set`
  with each `skills/` folder after `initialize` and before `thread/start` or `thread/resume`.
- **The plan.** `prepareSkillStart` in `drivers/skillIndex.ts` returns a `SkillStart`: read-grant
  folders, plugin folders, `firstTurn(advertised)`, and `retire()`. `ProviderSessionLifecycle` records
  every command and skill name a start's `session_metadata` events advertise, through the
  generation-checked callback, so a retired start's events count for nothing. At the first turn, a skill
  the harness has advertised as `acorn-<pluginId>:<id>` is native, and any other goes in the index at the
  copy's path. The folder is removed when the process stops, when a start fails, or at shutdown. The
  agents plugin's boot pass removes copies no live session uses.
- **Withdrawal by name.** `config.skillIndex` holds the names the agent was last told, native names
  first, in place of phase 06's digest. A start names whatever is gone: "These procedures were removed
  and can't be loaded now, even if an earlier list in this conversation names them: …". A phase 06
  digest reads as no names.
- **Status.** `SkillDelivery` and `PluginSkillState.deliveries[]` gain optional `native: true`, and
  `recordSkillDelivery` takes `native`. Settings reads "Loaded natively by Claude Code at …", "Reached
  … through acorn's list at …", or "Left out of a full list for …". The transcript line lists native
  names with "(native)".

No migration and no package change. The wire change is the optional `native` field. The service boot
budget rose 1 KB to 3,145,500 B. Writing and sweeping the copy load with the index on first use. The
per-event advertisement check, the retire calls, and the native flags run on every start or event.

**Provider evidence.**

- **Claude Code 2.1.292, adapter `@agentclientprotocol/claude-agent-acp` 0.54.1, Agent SDK 0.3.197.**
  The adapter spreads `_meta.claudeCode.options` into the SDK options on `newSession`, `resumeSession`,
  and `loadSession` alike, through one `createSession`. It overrides only `cwd`, `mcpServers`, `env`,
  `hooks`, and a few others, and leaves `plugins` alone. The SDK maps each local plugin to
  `--plugin-dir`. Direct CLI runs in a scratch folder showed the rest. The `init` message lists
  `pi-skills:release-note` with `--plugin-dir`. A resume without the flag drops it from the command
  list, and a resume with a new path picks up the new path. A resume that adds a plugin gets a delta
  `skill_listing` attachment. A resume that drops one gets nothing, and the model still quotes the old
  listing from history, which is why the removal is named. A session plugin whose name matches an
  installed one, `ponytail`, replaced the installed plugin for that session, hence the `acorn-` prefix.
  Claude names a plugin skill `<plugin name>:<folder name>` and ignores the frontmatter name.
- **Codex 0.159.2.** `codex app-server generate-json-schema` lists `skills/extraRoots/set` with
  `extraRoots: AbsolutePathBuf[]`. `skills/list` takes only `cwds` and `forceReload`, and
  `thread/start` and `thread/resume` have no skill field. A stdio probe set a root and saw the skill in
  `skills/list` beside all of the person's own skills, with `~/.codex/config.toml` unchanged. A second
  probe pointed `thread/start` at a local model provider through `config.model_providers` and captured
  the `/v1/responses` body. The skill was in the developer message's skill list on start and on
  resume, and a `$acorn-pi-skills:release-note` mention put the body in the request. No usage was
  spent. Codex names a skill under a plugin manifest `<plugin name>:<frontmatter name>`, which is why
  the copy's name becomes the id. A resume without the root kept the old listing in history.

**Decisions and deviations.**

- **The native name is `acorn-<pluginId>:<id>`, not the canonical `<pluginId>:<id>`.** Without the
  prefix a plugin named like one of the person's own Claude plugins would hide it. Mapping back drops
  `acorn-`.
- **Native counts only once the harness advertises it.** A written folder isn't evidence. Claude's
  `available_commands_update` and Codex's `skills/list` are. A skill not yet listed at the first turn
  goes in the index too, so a race or a refused plugin costs a duplicate line, never a hidden skill.
- **The frontmatter name is rewritten in the copy.** The first build rewrote it to the full native name,
  and the real Codex session listed `acorn-pi-skills:acorn-pi-skills:release-note`, because Codex adds
  the manifest's name itself. The fix writes the bare id. My earlier probe had no `plugin.json`, so it
  missed this.
- **One folder per start, removed when its process stops.** No reference counting. The lifecycle runs
  one process per session, and a new start begins only after the old process has stopped.
- **`config.skillIndex` changed meaning** from a digest to a list of names, because a native withdrawal
  has to name what went away, and a sentence saying nothing is available would contradict the harness's
  own skills.
- **No acorn slash-command expansion and no composer change.** The composer already shows each
  harness's own `/` and `$` lists, so native skills appear there, and portable ones don't.
- **The skills page split.** `docs/managed-agents/skills.md` passed 200 lines, so native delivery moved
  to `docs/managed-agents/native-skills.md`, with an anchor left behind.

**Verification.**

- `pnpm lint` passes. `@acorn/arch-tests`: 86 passed.
- `skillIndex.test.ts`, 7 cases: a copy per contributor with supporting files, two plugins with the
  same id under different names, the frontmatter name rewritten (a block value whole, the body left
  alone), the index until the harness lists a skill, a removal named, a phase 06 digest read as none,
  and a folder that can't be written putting everything in the index at installed paths. `retire`
  removes the folder.
- `runtime.test.ts`, through the lifecycle with a native fake driver: the plugin folder under
  `agent-skills/<session>`, `format.md` copied, no index part once advertised, a native delivery
  recorded, the told names saved, archive removing the copy, a new copy on the next start, an
  advertisement from the retired start ignored so the skill falls back to the index at the copy's
  path, only the live copy left, and shutdown removing it. The phase 06 case now expects the named
  removal.
- `codexDriver.test.ts`: extra roots sent before `thread/start` and before `thread/resume`, and not
  sent without skills. `contextBlock.test.ts`: Claude's `plugins` option beside the read grant.
- Suites: `@acorn/plugin-agents` 1,158 passed. node-core `skills.test.ts` 9 and `plugins.test.ts` 59
  under Node 26.8.1.
  The full `pnpm test` under Node 26.8.1 failed 5 of 36 tasks, none from this phase:
  `@acorn/node-core` on the 3 `backup.test.ts` cases that pass on Node 24, `@acorn/node` on the
  known `routeRegistry.test.ts` terminal route, `@acorn/client-core` on the known `scopes.test.ts`
  and `cssHygiene` reds and a `panes.test.tsx` timeout, `@acorn/desktop` on 11
  `clientPluginDisable.test.ts` cases that expect no `terminal.run.setup` command, from the same main
  merge, and `@acorn/tui` on a `workerFactoryOwnership.test.ts` deadline. The `panes.test.tsx` and TUI
  cases pass alone, and the panes timeout moved to another case between runs.

Real host, `pnpm dev:agent -- --session pi-phase-07`, with `pi-skills` 0.1.0 installed and approved,
in a throwaway repository with one uncommitted change:

- **Claude, Opus 5.5.** Typing `/acorn` offered `/acorn-pi-skills:release-note` beside the person's own
  commands. Sending it "for the uncommitted change" showed **Launching skill:
  acorn-pi-skills:release-note**, a read of `format.md` from the start's copy, a note ending
  "Formatted with the pi-skills release-note procedure.", and "Skills the agent can load:
  acorn-pi-skills:release-note (native)." No index part went with the turn. Settings said "Loaded
  natively by Claude Code at 04:15 PM" (`p7-native-turn.png`, `p7-settings-native.png`).
- After the switch was turned off and the Node restarted, `agent-skills/` was empty. The resumed
  session answered "No" and quoted the removal sentence. The composer's 93 commands, `ponytail` and
  `runn` among them, didn't include the skill (`p7-resumed-removed.png`,
  `p7-insert-after-removal.png`).
- **Codex, GPT-6-Sol.** Codex had usage available on 2026-10-07, despite the expected limit. After the
  name fix, `$acorn-pi-skills:release-note` was among its 56 skills. Sending it, Codex used the skill,
  read `format.md` from the copy, and ended with the fixed line. Settings recorded a native Codex
  delivery. Switched off and resumed, Codex quoted the removal sentence and listed none of acorn's
  skills (`p7-codex-insert.png`, `p7-codex-native-turn.png`, `p7-codex-resumed.png`).
- The repository's status showed only the seeded change. `~/.claude/plugins/installed_plugins.json`,
  `~/.claude/settings.json`, and `~/.codex/auth.json` weren't modified. `~/.codex/config.toml` changed
  during the Codex session with Codex's own model counters, and names no skill folder.
- Screenshots are in the session's ignored `.acorn/agent-dev/pi-phase-07/screenshots/`.

**Limitations.**

- **The terminal client wasn't driven.** It draws the same `AgentComposer`, whose `/` and `$` lists
  come from the session row, and this phase changed no terminal code. The terminal client has no
  skills settings (phase 06).
- **Claude's advertisement can race the first turn.** The adapter sends its command list on a timer
  after the session is created. The real host listed the skill before the first turn every time. If it
  arrives late, that turn carries an index entry as well, and the copy is still what the agent reads.
- **DeepSeek and `omp` weren't run.** Neither is installed. They keep the index, which phase 06's
  runtime test covers.
- **A package installed while a Claude session runs** reaches it at the next start, as before.

**For phase 08.** The index now holds only skills no harness took natively, so on Claude and Codex it's
usually empty. A resource-read experiment that measures context should count the native listing, which
each harness writes itself, separately from acorn's context parts. `SkillStart.folders` is still the
only read grant, and it now points into `agent-skills/`.

## Outcome

Claude receives the enabled skills through its verified local-plugin interface. Codex receives them
natively if its app-server supports an additive skill root; otherwise its tested portable delivery
remains the accepted outcome. The composer presents only choices the running session actually has.
Source: [native delivery design](./06-portable-skills.md#delivery-in-two-layers).

## Ownership and data flow

Phase 06 catalogue and enablement → agents per-session delivery planner → harness-specific adapter
→ native runtime skill list → agents wire descriptors → broker/cache → shared composer.
Keep native protocol knowledge in the drivers and reuse the core catalogue and host trust decision.

Read `plugins/agents/src/server/drivers/claudeHarness.ts`, `codexDriver.ts`, `codexConfiguration.ts`,
`plugins/agents/src/contract/wire.ts`, and composer skill handling. Inspect the pinned SDK/adapter
and app-server schemas before deciding supported configuration; phase 06's design leaves Codex's
door unverified.

## Implementation

1. Confirm the Claude SDK local-plugin-folder and readable-directory options, their ACP adapter
   forwarding, and support on both new and resumed sessions. Record the provider versions and exact
   option names. Do not assume `_meta.claudeCode.options` passes every SDK option unchanged.
2. Build a session-owned plugin folder under the Node data root from accepted enabled skills.
   Preserve standard skill files/supporting assets, namespace collisions, and immutable generation
   ownership. Pass only that folder to the harness; never edit `.claude/skills` in the worktree.
   Retain a generation while a process uses it, and clean it on archive/shutdown/replacement without
   invalidating a live provider's reads.
3. Inspect Codex `thread/start`, `thread/resume`, skill listing/configuration, and public extra-root
   support. Use an additive root only when it preserves the user's configured skills and credentials.
   Never relocate `CODEX_HOME` or copy credentials. If no supported root exists, record that finding
   and keep phase 06 delivery. This is an accepted fallback, not unfinished implementation.
4. Select one delivery method per skill per session: native when verified, otherwise portable when
   readable, otherwise unavailable with a reason. Remove the portable index entry only after native
   delivery is established. A failed native setup must restore a valid portable plan or show the
   failure without hiding the skill.
5. Map native names back to canonical plugin skill IDs. Refresh skill descriptors at process start
   and resume, preserve harness-native procedures from other sources, and avoid duplicate composer
   choices. Present only invocation syntax the harness supports. Do not claim ACP has a native
   skill API or add an unverified universal slash-command expansion path.
6. Show the chosen mode and relevant limitations in phase 06's delivery status. Keep settings,
   composer, and protocol metadata scoped to the selected Node and active session generation.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove new/resume configuration,
no duplicate index entry, native failure fallback, stale generation rejection, asset retention, and
cleanup. Cover coexistence with user skills and two plugins using the same local skill ID.

On real Claude sessions, select and load a contributed skill through supported native syntax,
then disable and resume. Check that login and worktree files are unaffected. On Codex, prove either
native start/resume/listing or a recorded absence of the door with working portable delivery. Inspect
composer and plugin status on desktop and terminal; record any provider-specific invocation limit.

## Documentation and handoff

Update [managed agents](../../managed-agents.md),
[client surfaces](../../managed-agents/client-surfaces.md),
[manifest authoring](../../plugin-authoring/the-manifest.md), and provider checks. Publish the
portable/native/unavailable matrix, refresh timing, and credential-preserving Codex disposition.
Retain importer/discovery work under phase 06's
[deferred section](./06-portable-skills.md#later-claude-code-plugin-folders), not as a phase task.

## Verify before building

Recheck phase 06's delivered IDs and staging ownership, official pinned provider configuration,
resume semantics, skill invocation syntax, and whether native metadata really reaches the ACP client.
Do not mark a composer choice available solely because a folder was successfully written.
