# Agent and provider checks

Run these checks with real agent CLIs and model connections when changing onboarding, generation,
delegation, or transcripts. The numbers retain their original acceptance-check IDs.

## Onboarding, generation, and delegation

Next is the first-run wizard's AI step
([integrations.md](../integrations.md) § Model providers). The plugin's own jsdom suite draws the step
against a fixture route, and what it cannot see is the route answering from a real `which` on a real
machine, or the wizard's own flow around the step.

58. Clear the `onboarded` preference on a node with no projects and walk the wizard end to end. On
    **Generate with AI**, every agent CLI on that machine is a row saying it is installed, and every
    one that offers a one-shot mode and is not there is a quiet row saying so, with no alert. Press a
    provider card, paste a key, and press **Connect**: the rows above gain that provider, and the
    step's **Next** was enabled before you did any of it. Then walk the wizard again on a machine
    with no CLI installed and no key: the step says Settings, under AI models, is where this lives,
    and **Next** still works.

The last four are the Generate list's, owed since the backends over installed agent CLIs shipped and
**not yet run** ([integrations.md](../integrations.md) § Model providers). The list builder, the
dispatch, the containment and the picker all have suites, and none of them can spend a real CLI on a
real machine, which is the whole point of the feature: the reader who has `claude` or `codex` on PATH
and no API key at all. Run them with the keys disconnected first.

59. With no model provider connected and `claude` installed, open the SQL dialog on a task with a
    database connection, press the commit-message wand on a task with staged changes, and press
    **Generate** in the workflow editor. All three offer Claude Code, and all three come back with an
    answer. Then connect a key and run ⌘K → **Generate SQL**, the palette path that draws no picker:
    it spends the key, not the CLI, because connections come first in the list and that fast path
    takes the first backend. Last, sign out of the CLI (or rename it off PATH between the read and the
    press) and generate again: the failure names Claude Code and says to run it once in a terminal,
    and the node log has the stderr tail while the client gets none of it.
60. Pick Codex in the commit wand and press it. The picker offers no model select for Codex, because
    its model list lives in `~/.codex/config.toml` rather than here, and the message still arrives.
    Then run a workflow with a `decide` step whose profile is `codex`: it reaches a verdict and the
    run carries on past the gate, which is the check that Codex's own stream shape is being read
    ([managed-agents.md](../managed-agents.md) § Harnesses).
61. Pick Anthropic in the commit wand, then open **Generate** in the workflow editor: it opens on
    Anthropic. Disconnect the key and open it again: it opens on Claude Code. Change the default in
    Settings, under AI models, and both open on that instead. The SQL dialog is expected not to
    follow any of this and to open on the first backend every time
    ([state-ownership.md](../state-ownership.md) § Scope rules).
62. The acceptance test for the manifest one-shot block, which needs `opencode` installed. Write the
    OpenCode plugin from [plugin-authoring.md](../plugin-authoring.md) § Harnesses alone, without
    reading this repository, install it from a folder, and approve the trust prompt: it shows two
    lines, the ACP spawn and `opencode run --model MODEL` to generate text. OpenCode then appears in
    the Agent pane, in a task terminal, and in every Generate control, and generates a commit
    message. That the doc is enough on its own is what is being checked, so a step that sent you to
    the source is a failure of the doc.

The next two items cover agent-driven delegation. They were not run for this implementation because
the available checkout cannot launch the app without GitHub credentials. The automated suites cover
the Node, storage, MCP, runtime, and component contracts; these items remain the provider-backed
acceptance pass.

63. Enable the execute tier in Settings → Tools and permissions. From a Claude Code terminal, call
    `agent_spawn` once with shared isolation and once with worktree isolation. Use `agent_wait` and
    paged `agent_read` to collect each answer, then use `agent_prompt` for a second turn and
    `agent_cancel` on an active turn. Repeat from a Codex terminal. Confirm that retrying the original
    MCP call does not create another task, session, or turn; the shared child appears in the same task's
    Agent pane; and the worktree child appears under its parent task and opens its own panes.
64. Repeat the same flow from one managed Claude Code parent and one managed Codex parent. Confirm
    that each child nests under its managed parent, the parent chip returns to that session,
    provider-native subagents still render under their provider session, and a child can create one
    directly owned grandchild but the next level is refused. Trigger a permission or question request
    in a child and confirm `agent_wait` reports attention without giving the parent an approval action.
    Narrow the parent's tool ceiling and confirm the child cannot widen it. Run the parent as a
    workflow-owned session and confirm `agent_spawn` is absent.
    Then let the managed parent end its turn while a child is still working. Confirm that one
    "From" report turn arrives in the parent with the child's final message, that the child's
    transcript labels the parent's prompt "From" and the parent's title instead of "You", and that a
    parent which reads the result with `agent_read` before its report runs receives no report.

## Transcript and harness behavior

70. Run a Codex session and a Claude Code session that each search the web for a distinctive phrase,
    then open one result. Confirm each call is one card, that the row says `Search web` with the query
    beside it, and that opening it shows the query, any domain filter, and the sources as links. Run
    Claude `WebFetch` and confirm it reads as a page fetch with its prompt rather than as a search.
    Make a provider-native subagent search in each harness and confirm the card stays in the child's
    transcript. Then search Agent Center for the phrase, a result title, a domain and a URL fragment.
    Finish in the terminal client at 80 by 24: open and close the fold, focus a result link, and
    confirm the address is readable. Last, open a Codex session recorded before this shipped and
    confirm its status-only row still draws as the flat `Web search` row
    ([managed-agents.md](../managed-agents.md) § Web activity).

71. The reconnect an agent advertises rather than declares, which needs `dsh` installed and the
    DeepSeek plugin at `../acorn-deepseek` loaded from a folder. Start a DeepSeek session, get an
    answer, quit the app and start it again, then ask the agent about something only the earlier turn
    could know. It should remember, and the transcript should carry no "starts fresh" warning: that is
    `session/resume`, and before it acorn silently began a new agent under the unchanged transcript.
    Check the pane while you are there, because DeepSeek's surface is narrower than Claude's on
    purpose: permission cards work, the model picker lists its models and reasoning effort, cancel
    stops a turn, and there is no plan section, no mode picker and no question card
    ([managed-agents.md](../managed-agents.md) § Harnesses).

72. The two doors a harness declares and the one it does not. With the same plugin loaded, ask DeepSeek
    something only an acorn tool can answer, such as what the task is about or what the local diff
    contains: it reaches them over the protocol, because it has no `mcp add` command to register
    through ([mcp.md](../mcp.md) § Configuration). Then ask Claude Code the same in a task terminal and
    confirm each acorn tool still appears once, not twice. Last, press the commit-message wand and open
    **Generate** in the workflow editor: both offer DeepSeek, and it answers. Its terminal profile menu
    entry should be absent throughout, because `dsh` alone has no interactive mode.

155. The contributed `omp` harness, which needs `omp` on the Node's `PATH` and the package in
    `docs/future/pi/packages/omp-harness/` installed from its folder. Sign in once by opening a task
    terminal on **oh-my-pi** and finishing `omp`'s own setup. Start an oh-my-pi session: the pane
    shows `omp`'s **Mode**, **Model**, and **Thinking** options. Ask for a file write, which runs
    without a card, then a shell command, which raises a permission card. Reject it once and allow it
    once, and confirm `omp` reports the rejection as a failed `bash` call. Ask it to use its `ask` tool
    with two options and confirm the question card offers both plus a free-text field. Restart the
    app and send another turn: the session remembers the earlier turn, because the driver picks
    `session/resume`. Run a one-step workflow on `omp:omp` and have a Claude Code session delegate to
    it with `agent_spawn`. Both run as managed `omp` sessions. Last, read the turn after a provider
    error, such as an over-long prompt: `omp` sends it as an ordinary answer ending in `end_turn`, so
    a workflow step reads it as success ([the omp harness phase](../future/pi/01-omp-harness.md)).

156. A loaded permission policy. Install `docs/future/pi/packages/permission-policy/` from its folder,
    restart the Node, and read the trust prompt: it says the plugin can stop the agents plugin from
    running a tool the agent asks permission for, marked high. Then, in a Claude Code session in a
    permission mode that asks before Bash, ask the agent to run `git push --force`. No card asks you
    anything. The transcript shows a resolved permission that says **Blocked by
    acorn-permission-policy** with the policy's reason, the session never shows "Needs you", and the
    agent reports a rejected call. Repeat in Codex with an approval policy that asks, where the
    refusal goes back as `decline` and the turn carries on, and in DeepSeek and `omp` when they're
    installed. Ask for `rm -rf /tmp/outside` and confirm the second rule refuses it, then for
    `rm -rf build` inside the task and confirm the ordinary card appears
    ([permission policy](../managed-agents/permission-policy.md)).

157. A policy plugin's explanation. With the policy from check 156 installed, the **Permissions** tab
    also says it can send notes to your agent sessions, marked high. Run **Permission policy: explain
    refusals to the agent** from the palette and pick **On**. In a Claude Code session in **Default**
    mode, ask the agent to run `rm -rf /tmp/<throwaway>`. The transcript shows the blocked request,
    then one turn labelled **From acorn-permission-policy** whose visible text says the plugin sent a
    note. Its context manifest names `plugin:acorn-permission-policy`, and the agent's answer
    acknowledges the refusal without retrying. Repeat in Codex. Then check that a terminal-held
    session and an archived session get no note, that cancelling the queued note works like any queued
    turn, and that switching Nodes and back keeps the label. In the terminal client, the note reads
    **From acorn-permission-policy** too. A workflow step's refusal stands with no note
    ([session messages](../managed-agents/session-messages.md)).

158. The advisor and its model grant. Install `docs/future/pi/packages/advisor/` and restart the Node.
    The trust prompt lists generating text and sending notes to your agent sessions. On the plugin's
    page in **Settings > Plugins**, **Model** says it isn't set up. Choose a backend, a model, and a
    daily allowance, and **Save**. A backend the Node doesn't have, or a model outside its catalog,
    is refused with a reason. In **Settings > Agents > Advisor**, set **Review sessions** to
    **Interactive sessions**. In a throwaway repository, break a function in the task's working tree,
    then ask a Claude Code session for an unrelated edit. After the turn, the transcript shows a turn
    labelled **From acorn-advisor** with a blocker, and the agent answers it. **Recent notes** lists
    the blocker as **Sent to the agent**, and the plugin page's **Today** row shows the charge: 4,000
    output tokens for a CLI call. Remove the grant and send another turn: no call is charged, and the
    advisor shows `provider_not_configured`. Turn reviews off and send a turn: no review runs. Restart
    the Node during a review: it isn't retried, and its charge stays
    ([plugin model grants](../integrations/model-providers.md#plugin-model-grants)).

163. Native skills. Install `docs/future/pi/packages/skills/`, restart the Node, and approve the skill.
    In a throwaway repository with one uncommitted change, start a Claude Code session and type
    `/acorn`: the composer offers `/acorn-pi-skills:release-note` beside your own commands. Send it
    with "for the uncommitted change". The transcript shows **Launching skill:
    acorn-pi-skills:release-note**, a read of `format.md` under `agent-skills/` in the Node's data root,
    a note ending "Formatted with the pi-skills release-note procedure.", and "Skills the agent can
    load: acorn-pi-skills:release-note (native)." The plugin's page says **Loaded natively by Claude
    Code**. Turn the skill off, restart the Node, and ask the session whether it can still load it: it
    quotes "These procedures were removed…", and the `/` list no longer has it. `agent-skills/` is
    empty after the restart. Repeat with Codex, using `$acorn-pi-skills:release-note`. The repository's
    status shows only the seeded change, and neither harness's config file names the skill folder
    ([native delivery](../managed-agents/native-skills.md)).

164. Harness bridges. Install `docs/future/pi/packages/permission-policy/` 0.5.0 and restart the Node.
    Its **Permissions** tab lists "Make a tool wait for you before agents can “run any tool”", and
    **Agents it reaches** reads **Every tool call, and every tool result.** for Claude Code and **Only
    the tool calls it asks you about.** for Codex. In a throwaway repository, start a Claude Code
    session, switch Mode to **Bypass Permissions**, and ask it to run `git push --force nowhere-remote
    HEAD`. The call fails, and the agent quotes "Blocked by acorn-permission-policy: Force-pushing
    rewrites shared history…" in the same turn. Ask for `git push nowhere-remote HEAD`: a permission
    card says "acorn-permission-policy wants you to decide: This pushes commits to a remote…". **Reject**
    fails the call with "The person refused this…". Repeat and press **Allow**: git runs and fails on
    the missing remote. Ask for one edit to a source file: the agent quotes the "Test first: …" note.
    `~/.claude/settings.json` is unchanged ([harness bridges](../managed-agents/loop-hooks.md)).
