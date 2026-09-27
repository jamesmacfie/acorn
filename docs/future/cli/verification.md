# Verification and delivery checklist

Status: proposed implementation handoff, 2026-09-27. This page is the cross-phase acceptance
record for the [CLI programme](./README.md), not a claim that these checks currently pass.

## Test layers

Each phase should add focused unit tests for parsing, typed stdin, output projection, schema
validation, and exit statuses. Integration tests should drive a real authenticated Node over `/v1`
with a temporary data root. Use plugin fixtures for agent and workflow lifecycle states so the CI
suite does not depend on a paid provider or an interactive approval. Keep one optional real-harness
smoke for a graphical development host or release checklist. Test the extracted distribution in a
clean temporary directory; a workspace build can hide missing package files.

The mandatory repository gate for every implementation batch is `pnpm lint` and the relevant
package tests. Use `pnpm test` for the whole suite if the change spans all runtimes; it preserves
Turborepo's bounded concurrency. For documentation-only edits, run the documentation path check in
`tools/arch/docPaths.test.ts` and `pnpm lint`. Preserve existing TUI and desktop tests where shared
custody or launch code moves.

## Phase gates

| Phase | Automated proof | Manual or artifact proof |
| --- | --- | --- |
| 1: host and reads | Parser and JSON schema snapshots; two-Node custody and pinning; route reads; dependency graph excluding renderer. | No-argument TUI boot; headless help/read; extracted archive read. |
| 2: service | Startup handshake, lock race, stale owner, log modes, and stop authorization tests. | Start/status/stop from clean extracted archive; inspect arguments and logs for token absence. |
| 3: core writes and agents | Workspace/project CRUD and membership; project config and provider mapping checks; task create hook fault injection; agent key replay, events gap, wait states; stdin and cross-Node checks. | Create and reorganize workspaces/projects, then create a task, launch provider fixture, exit and inspect from a second process. |
| 4: workflows | Definition source/trust tests; typed inputs; owner-guarded single run; crash-gap replay; partial merged source. | Start a published workflow, exit, inspect steps and terminal state from a second process. |
| 5: plugins | Manifest/schema/route validator, active-version reload, permission and scope tests, response validation. | Implement a test plugin from the authoring guide and run it against two Nodes. |

## Cross-cutting failure matrix

For each mutating command, inject failure at validation, before dispatch, after the Node domain
write, after the response is saved, and during CLI output. Record whether a retry is safe, whether
the caller has an ID to inspect, and whether the CLI can present a partial result. Test the same
request key with identical and changed bodies. The generic device replay store saves non-5xx
responses but cannot prove a domain write did not happen before a crash. Do not describe a command
as exactly once without a domain-level intended ID or equivalent proof.

For every command, exercise no TTY, stdout piped, stderr captured, expired token, unpaired Node,
changed certificate pin, incompatible protocol, loaded plugin missing, unknown ID, wrong Node ID
in a pipe, and malformed JSON. A read of a failed run should exit successfully; `wait --check`
should exit with the documented checked-failure code. Ctrl+C should leave background work running.
No token, secret, SQL credential, prompt content, or raw stack trace should appear in routine
diagnostics or service logs.

## End-to-end script acceptance

These examples are intended future commands. Replace the illustrative definition/profile IDs
with values from the seeded Node when writing the actual test.

```sh
set -o pipefail
acorn node start --background --output json > node.json
acorn workspace create --name Platform --output json > workspace.json
acorn project add --workspace "$(jq -r .id workspace.json)" --path /srv/repos/api --output json > project.json
acorn task create --project "$(jq -r .id project.json)" --title "Review API" --output json > task.json
acorn agent start --task "$(jq -r .id task.json)" --profile codex --prompt-file brief.md --output json > session.json
acorn agent show "$(jq -r .id session.json)" --output json
acorn workflow list --task "$(jq -r .id task.json)" --output json
acorn workflow start --task "$(jq -r .id task.json)" --definition repo:review --inputs-file inputs.json --output json > run.json
acorn workflow run steps "$(jq -r .id run.json)" --output json
acorn run list --output json
```

The shell process may exit after either start. A new process must find the same workspace, project,
task, session, and run by ID. If a prerequisite is absent, the failing command should identify the
missing resource or capability and leave prior resources inspectable. The final service stop is
separate and only permitted for a CLI-owned service.

## Release acceptance

Before calling the programme complete, publish an owning CLI reference page under `docs/` with
exact grammar, field schemas, error codes, output examples, installation and pairing steps, and
plugin authoring links. Update the documentation index and the help text from the same contract.
Run the script above against the extracted release artifact on supported hosts. Verify a local Node,
a remembered remote Node, and a two-Node fleet. Save the acceptance evidence with the release
checklist. This future folder remains a decision record and should point to the shipped reference.

## Verify before building

- Check the actual test scripts in root and package `package.json` files; use the repository's
  bounded `pnpm test` entry for a full run.
- Check `tools/arch/docPaths.test.ts`, TUI boot tests, Node standalone boot tests, and the existing
  plugin route and agent/workflow testkits before adding another fixture framework.
