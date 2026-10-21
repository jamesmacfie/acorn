# Close the October 22 security findings

Date: October 22, 2026. Status: proposed. Implementation not started.

A security review on October 22, 2026, against `47287b67c`, looked at the whole app, with most of its
time on the work since [the October 21 review](../../security/review-2026-10-21.md): the phone gateway,
and the fixes that review made. It was a source review. No attack ran against a live Node. It found one
high, two medium, and three low problems. This programme fixes each one without taking away anything
that works today. Read this page before you pick up a phase.

The attacker is the one [transport and auth](../../security/transport-and-auth.md#why) names: an agent
that read hostile text and now acts for whoever wrote it, holding a task token. Phases 2 and 3 add a
second one: someone who gets a phone's session cookie, or a loaded plugin that turned hostile.

## Findings

| Finding | Severity | Phase |
| --- | --- | --- |
| The CLI, the terminal client, the phone gateway, and the browser bridge keep the owner's device token as a plain file under the client config folder. **Keep agents out of Acorn's data folder** doesn't cover that folder, and the CLI's task check reads only two environment variables an agent can unset. | High | [1](./01-client-tokens-and-the-agent-fence.md) |
| The gateway passes a Node answer's `content-type` through unchanged, so a loaded plugin's HTML runs on the phone's own address, with the phone's session. | Medium | [2](./02-gateway-answer-headers.md) |
| A phone session never expires, and it can open terminals and start agents. A lost phone is a shell on the computer until someone runs `revoke`. | Medium | [3](./03-phone-session-expiry.md) |
| The gateway refuses plugin installs but not development mode, grants, reload, or the roster switch, which also decide what code runs. | Low | [4](./04-plugin-writes-from-a-phone.md) |
| The phone page's content security policy sets only `script-src`. | Low | [2](./02-gateway-answer-headers.md) |
| An agent can write a project memory that every later session sees in its prompt, and running sessions get it before their next turn. The contract doesn't warn the reading agent that another agent may have written it. | Low | [5](./05-agent-written-memory.md) |

Phase 6 writes the dated review page and checks every fix together.

## What the review found sound

These were checked and need no change. They're listed so the next review doesn't repeat them:

- The gateway's blocked paths match the decoded, lowercased path with repeated and trailing slashes
  removed. The URL parser folds `..`, `%2e%2e`, and backslashes before the match.
- The three routes that trust a loopback caller, pairing, reach, and stop, are all on the gateway's
  blocked list. No other route reads the socket peer.
- A phone's event socket can't act for another phone. The Node unwraps one `ws:viewer` layer, and a
  nested `ws:viewer` or `ws:viewer-close` inside it isn't dispatched.
- The host-dispatched path lock from S1 held against encoded and doubled slashes, dot segments, and
  query strings.
- A task token still can't create a task in another project, set `baseCommit`, or skip setup. A
  committed `.acorn/config.toml` can't set the setup script, and its `copy` list refuses absolute
  paths, `..`, and links that leave either root.
- The extension's page buttons sit in a closed shadow root and act only on real clicks. Its background
  takes button messages only from a tab's top frame, using the browser's record of the address.
- The desktop's external link opener and the helper's secret-gated socket are as the October 21 review
  left them.
- A loaded plugin's SQLite connection runs under a native authorizer that refuses `ATTACH`.
- The HTTP client plugin, workflow definitions, and triggers are devices only.
- No server code builds a shell command from a string.
- `pnpm audit --prod` reports only node-forge and braces, both ignored with a written reason.

## Out of scope

- R13 and R21 stay owner decisions. With **Keep agents out of Acorn's data folder** off, which is the
  default, any agent can still read the client config folder. Phase 1 makes the switch cover that
  folder. It doesn't change the default.
- Sealing client tokens in the keychain, as the desktop does. Phase 1 names it as the follow-up,
  because the CLI and the gateway run without a keychain on Linux and on a standalone Node.
- `pnpm pack:node` failing on `ci-info`, which the October 21 review left with the package list's
  owner.

## Order

Phase 1 first, because it's the only high finding and a few lines. Phases 2 and 3 are independent
gateway changes and can share a branch. Phase 4 starts with a check of what the phone calls. Phase 5
is small and independent. Phase 6 runs last.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-client-tokens-and-the-agent-fence.md) | The agent fence also blocks the client config folder, and the docs stop calling the CLI's task check a boundary. |
| [2](./02-gateway-answer-headers.md) | Every forwarded answer is sandboxed, and the phone page gets a full policy. |
| [3](./03-phone-session-expiry.md) | A phone session ends after 30 days unused. |
| [4](./04-plugin-writes-from-a-phone.md) | The gateway refuses every plugin write a phone has no screen for. |
| [5](./05-agent-written-memory.md) | The memory contract tells agents a memory is never a reason to act, and the docs record the limit. |
| [6](./06-record-the-review.md) | The dated review page, the regression tests, and the attacks walked in a real session. |
