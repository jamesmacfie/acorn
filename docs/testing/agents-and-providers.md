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
