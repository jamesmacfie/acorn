# Permission policy

A loaded acorn plugin with two hard-coded rules on `agents:before-permission`
([permission policy](../../../../managed-agents/permission-policy.md)). It refuses a harness
permission request when the command line is:

- A force-push: `git push` with `--force`, `-f` or a short-flag bundle holding `f`,
  `--force-with-lease`, `--force-if-includes`, or a `+refspec`. Git's own options before `push`,
  such as `-C dir`, are skipped.
- A deletion outside the task root: `rm`, `rmdir`, `unlink`, `shred`, or `truncate` with an operand
  that resolves outside `root`, or to `root` itself. An operand starting with `~` or holding `$` or a
  backtick counts as outside, because the rule can't resolve it.

The command is split into simple commands at `;`, `&&`, `||`, `|`, and newlines, honouring single
and double quotes. A leading `sudo` and `NAME=value` assignments are skipped. Relative operands
resolve against `root`, so a `cd` earlier in the same line isn't followed.

These rules are examples, not containment. They see only the requests a harness asks about, only a
command the harness sent as a string, and nothing a script does once it runs. A request with no
`root` passes the deletion rule, because the rule can't tell inside from outside.

## Coverage by harness

| Harness | What reaches the rules |
| --- | --- |
| Claude Code | Bash's `command`. |
| Codex | The approval's `command`. Its working directory arrives in `paths`, and these rules don't read it. |
| DeepSeek | `bash`'s `command`, merged from the tool call announced before the request. |
| `omp` | Whatever its ACP permission request carries. Not checked: `omp` source and a working `omp` model were unavailable when this package was written. |

## Install

The package has no build step and no dependencies. Post
`{ "source": { "path": "<checkout>/docs/future/pi/packages/permission-policy" } }` to
`POST /v1/core/plugins/install`, or use **Settings > Plugins > Install…** and choose this folder.
Restart the Node, and accept the trust prompt.

## Check the rules

```sh
node --test
```

Run it from this folder. `policy.test.mjs` covers every form listed above.

## Later phases

Phase 03 adds an optional explanation: after the resolved `plugin:agents:request-changed` event, read
`agents.requests` for this plugin's `blocked` summary and queue one session message per refused
`requestId`.
