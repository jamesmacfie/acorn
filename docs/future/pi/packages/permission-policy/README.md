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

## Explain refusals

Off by default. Run **Permission policy: explain refusals to the agent** from the palette and pick
**On**, and the plugin sends the agent one note per request it refused, through
`agents:session-messenger` ([session messages](../../../../managed-agents/session-messages.md)).

- The veto route records the session, task, and request ids in the plugin's own database
  (`migrations/`) and sends nothing, because a verdict the host ignores after its timeout isn't a
  refusal.
- On the resolved `plugin:agents:request-changed` event, it reads `agents.requests` and sends a note
  only for a resolved row whose `blocked.by` is `acorn-permission-policy`. Another plugin's veto or
  the person's own answer drops the record.
- Each time agents connects the sender, it reads every recorded refusal again, so a missed event or a
  restart doesn't lose one. A send that throws keeps its record for that pass.
- The idempotency key is `<sessionId>:<requestId>`, so one refusal is one note. A failed note never
  undoes the refusal. Workflow and delegated sessions answer `unattended-not-supported`, and the
  refusal stands with no note.

The manifest asks for `plugin:agents:request-changed`, the `agents.requests` capability, and a
declared `agents:session-messenger` extension, which the trust prompt shows as a high grant.

## Install

The package has no build step and no dependencies. Post
`{ "source": { "path": "<checkout>/docs/future/pi/packages/permission-policy" } }` to
`POST /v1/core/plugins/install`, or use **Settings > Plugins > Install…** and choose this folder.
Restart the Node, and accept the trust prompt.

## Check the rules

```sh
node --test
```

Run it from this folder. `policy.test.mjs` covers every command form listed above, and
`explanations.test.mjs` covers when a refusal is explained and when it isn't.
