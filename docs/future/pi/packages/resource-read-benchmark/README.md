# Resource-read benchmark

The fixtures behind [phase 08](../../08-resource-read-experiment.md). They measure whether MCP
resource aliases for acorn's read tools shrink an agent's first-turn context. The results and the
disposition are in the phase doc.

- `tools.json` is the tool list a development node advertised to a task session on 2026-10-07:
  38 tools with their names, descriptions, risk tiers, and input schemas.
- `fixture.json` is one made-up task: a pull request with a failing check, a linked Linear issue, a
  review comment, a local diff, a memory, and a note.
- `server.mjs` is a stdio MCP server with no dependencies. It serves `tools.json` in one of the
  three experiment modes, and answers tool calls and resource reads from `fixture.json`. Set
  `FIXTURE_LOG` to a file path to record every request it receives.
- `measure.sh` prints first-turn context tokens for Claude Code and Codex in each mode, plus a run
  with no acorn server.

## Modes

| Mode | `tools/list` | Resources |
| --- | --- | --- |
| `tools` | all 38 tools | none |
| `tools-and-resources` | all 38 tools | 7 fixed URIs and 4 templates |
| `resources-and-write-tools` | 27 tools, without the 11 aliased readers | 7 fixed URIs and 4 templates |

The fixed URIs are `task://`, `task://context`, `pr://`, `pr://files`, `pr://checks`,
`pr://comments`, and `changes://`. The templates are `issue://{kind}/{id}`, `changes://{path}`,
`memory://{name}`, and `notes://{kind}`. The design's `agent://{sessionId}` is left out because the
registry marks `agent_read` as `execute`, not `read`.

## Reproduce the measurement

You need `claude` and `codex` signed in. Each run sends one short prompt and spends a little usage.

```sh
./measure.sh          # both clients
./measure.sh codex    # one client
```

Claude Code runs with `--strict-mcp-config`, so only the fixture server is connected. The person's
other settings still load, the same in every mode. Codex runs `codex exec --ephemeral` with the
server added through `-c mcp_servers.acorn.*`.

To repeat the discovery probe, point either client at `server.mjs resources-and-write-tools` with
`FIXTURE_LOG` set, ask "Which task am I working on, and which CI check on its pull request is
failing and why?", and check the log for `resources/read`.
