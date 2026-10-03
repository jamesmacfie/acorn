# Agents and workflows

This page covers the CLI's managed agent and workflow commands, and the merged run list. It's part of
the [command-line client](../cli.md).

## Agents

`agent providers` reports the agents plugin's provider and profile roster, installation, sign-in, and
diagnostics. When more than one provider matches a profile, choose one with `--provider`.

`agent start` creates an interactive managed session and queues one text prompt of at most one million
characters. A prompt is input to the provider, not a shell command. `start` returns an `AgentSession`
with `firstTurnId`, and `agent send` returns an `AgentTurnAck`. Both acknowledge queued work. The CLI
warns when the task already has a managed session. Sessions on one task share its worktree, so use a
workflow child task for isolation.

`agent show` reads the durable snapshot and reports the most recent turn status and the pending request
count. `agent events` pages the durable event ledger. `--follow --output jsonl` reads more when a
WebSocket notice arrives, with a periodic refresh in case one is missed, and resumes from the last
durable sequence after a gap or reconnect. Ctrl+C stops only the local follow.

`agent wait` composes the Node's bounded long polls under one CLI timeout. A timeout exits 5. `--check`
exits 6 when the most recent turn failed or was cancelled, and prints the session. Attention is reported,
never approved for you.

```sh
set -o pipefail
acorn task create --project "$PROJECT_ID" --title 'Review API' --output json |
  acorn agent start --task - --profile codex --prompt-file brief.md --output json |
  acorn agent wait - --until turn-completed --check --output json
```

## Workflows

`workflow list --task` reads published repository, user, and database definitions from the workflows
plugin. File IDs start with `repo:` or `user:`, and database rows use their own IDs. Machine output
includes the source, declared inputs, the published revision when there is one, validity, whether it can
run, and parse or validation errors. An unavailable workflows plugin is a capability error.

`workflow start` sends only the definition ID and an optional JSON object of typed inputs, which keep
their JSON types, including explicit null. The Node checks the definition again at start, including the
repository trust snapshot and contributed step kinds, and reports a refusal as a domain error. It
acknowledges a durable run and returns a `WorkflowRun`, and the run continues on the Node. If the answer
is uncertain after a write, the CLI exits 7, prints the request ID, and points you at
`workflow run list --task ID` before you retry. The replay store can't rule out a second run after a
crash between run insertion and replay save.

`workflow run show ID` and `workflow run steps ID` are direct durable reads. `steps` returns step
metadata and child run IDs, without result bodies.

`workflow run wait ID` reads the run and up to 200 compact step statuses at a bounded interval, and
`stepsTruncated` says when more exist. `--until finished` covers success, failure, a safety rail,
completed with failures, and cancellation. `--until attention` also catches a gate awaiting action.
`--check` exits 6 for a failed or cancelled run and prints it, and never approves a gate. A plain `show`
succeeds when it reads a failed run. `--timeout` takes seconds or a suffix such as `30m`, up to 24 hours.
Ctrl+C stops the local wait.

## The run list

`run list` is a bounded view of recent summaries merged from the agent, workflow, and schedule sources.
JSON includes `failedSources`, `complete: false`, `sourceLimit: 200`, and `truncated: "unknown"`, and a
source can impose a lower limit. Text output says it's bounded and names failed sources. `--workspace`
selects runs whose task belongs to the workspace, so taskless schedule runs drop out. For an owner's full
history, use `workflow run list --task ID` or `agent list`.
