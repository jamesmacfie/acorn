# Close the October 21 security findings

Date: October 21, 2026. Status: proposed. Implementation not started.

A security review on October 21, 2026, against `32b2ab6c3`, looked at the work since
[the October 11 review](../../security/review-2026-10-11.md): about 540 commits, including record
triggers, row actions, panel and app cards, supplied rows, code search, pairing by approval, and remote
MCP sign-in. It found one high, three medium, and two low problems. This programme fixes each one
without taking away anything that works today. Read this page before you pick up a phase.

The attacker throughout is the one [transport and auth](../../security/transport-and-auth.md#why)
names: an agent that read hostile text and now acts for whoever wrote it. Every agent holds a task
token, the internal credential the Node mints for one task, in its environment.

## Findings

| Finding | Severity | Phase |
| --- | --- | --- |
| A task token can call a loaded plugin's tool, context section, or CLI command handler directly over HTTP. That skips the tool's risk tier, the owner's tool permissions, the signed ceiling, input checks, and the CLI command's device check. | High | [1](./01-plugin-handler-routes.md) |
| The **Allow a new client?** dialog swaps a newer request in place, so an agent asking every three seconds can land its own request under the owner's click and collect a device token. | Medium | [2](./02-pairing-approval.md) |
| A task token can create a task in any project with a title, branch, and `origin` it chooses. A record trigger on the Tasks source hears that within seconds and starts a workflow. | Medium | [3](./03-agent-created-tasks.md) |
| A record trigger hands text that strangers wrote, such as a GitHub issue, to an unattended agent step. If the step's harness runs without asking permission, nothing stands between that text and a shell. | Medium | [4](./04-unattended-agent-steps.md) |
| `pnpm audit --prod` reports five advisories: Hono's `serveStatic`, and four in the public site's build. | Low | [5](./05-dependencies.md) |
| The plugin scaffold's starter route loads any task by ID, so it teaches authors a cross-task read. | Low | [1](./01-plugin-handler-routes.md) |

Phase 6 writes the dated review page and checks every fix together.

## What the review found sound

These were checked and need no change. They're listed so the next review doesn't repeat them:

- Trigger, schedule, and workflow definition routes are device-only, including the legacy
  `/workflows/schedules` path.
- The **Code matches** source passes `--no-config` and `--` to ripgrep, so a pattern can't become a
  flag such as `--pre`.
- `dataset_write` holds a task to its own project's datasets, and supplied rows carry values only, no
  actions or targets.
- The shared Markdown renderer escapes before it formats. Its links, autolinks, emphasis, and table
  cells couldn't be made to open an attribute or a tag. The provider HTML sanitizer copies allowed
  tags into new nodes.
- The desktop's external link opener refuses `file:`, `javascript:`, `data:`, app schemes, and
  `acorn://`.
- Remote MCP sign-in checks `state`, sends tokens over https only, and listens on a one-request
  loopback path with 128 random bits in it.
- Pairing codes are 128 random bits, five attempts, and single use.
- The extension's background answers a `sidebar` port only from its own page, and content scripts
  only from a tab's top frame.
- The HTTP client plugin's routes are device-only.

## Out of scope

- R13 and R21 from the October 11 review stay owner decisions. Agents can read the data root unless
  **Keep agents out of Acorn's data folder** is on, and an ad-hoc signed build keeps `data.key` in a
  plain file. Phase 4 narrows what an unattended agent can do. It doesn't change either default.
- A blanket rule that refuses task tokens on every loaded plugin route. The October 11 review recorded
  that as a plugin contract change needing its own design. Phase 1 closes only the paths the host
  itself dispatches.

## Order

Phase 1 first, because it's the only high finding and the smallest change. Phases 2, 3, and 5 are
independent and can run in any order. Phase 4 starts with a check that may shrink it to a disclosure.
Phase 6 runs last.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-plugin-handler-routes.md) | The host refuses an internal caller on a loaded plugin path it dispatches itself. Docs and the scaffold stop promising otherwise. |
| [2](./02-pairing-approval.md) | A second pairing ask cancels the first, and the dialog never swaps a request under the owner's cursor. |
| [3](./03-agent-created-tasks.md) | A task token creates tasks only in its own project, and the Node stamps where the task came from. |
| [4](./04-unattended-agent-steps.md) | A trigger-started agent step can't run with checks off unless the owner chose that for that trigger. |
| [5](./05-dependencies.md) | Hono to 4.13.11 and the site's build advisories cleared. |
| [6](./06-record-the-review.md) | The dated review page, regression tests listed, and the audit rerun. |
