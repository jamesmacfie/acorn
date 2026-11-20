# Security findings from November 20, 2026

The November 20, 2026 review looked for ways to run code on a user's Node without their approval.
The Slack, account service, relay, and Node findings cite Acorn `90b9e61e3` and
`acorn-cloud` `19fa594`. A later pass the same day traced the path from the account service to a Node
at Acorn `31ff472da` and added L-6, C-5, and R-6 to R-9.

Acorn fixed its side of 24 findings, one commit each.
[The November 20 review](../../security/review-2026-11-20.md) records each fix, the decisions behind
it, and the GitHub settings the owner must change. What's left below is `acorn-cloud` work. Each open
finding has one report with its evidence, fix, and verification requirements.

## Where to start

Fix [C-3](./c-3-email-code-budget-resets.md) first. It's the one high finding with no Acorn fix, and
an account is the starting point for most of the others. Then route each Slack card's clicks to the
Node that posted it, as [G-1](./g-1-click-on-another-card-approves.md) asks.
[G-5](./g-5-new-holder-edits-earlier-bot-messages.md) needs the same message ownership data.

Do [R-6](./r-6-previews-put-the-cloud-inside-tls.md) before the hosted service serves previews. Do
[C-4](./c-4-cloud-deploy-can-use-untested-acorn-revision.md) and
[D-4](./d-4-relay-build-context-can-include-local-secret-files.md) together, because the relay build
should use the one Acorn commit the deploy resolves.

## The findings

All of these are `acorn-cloud` work. For G-1, C-5, R-6, D-4, and R-7, the Acorn side is fixed and the
report covers only what's left.

| ID | Severity | Finding |
| --- | --- | --- |
| [C-3](./c-3-email-code-budget-resets.md) | High | Email sign-in attempts reset across code issuances. |
| [G-1](./g-1-click-on-another-card-approves.md) | High, conditional | The gateway routes a card's clicks by the thread, not by the Node that posted the card. |
| [C-5](./c-5-sign-in-approval-shows-a-name-the-asker-chose.md) | Medium, needs an approved code | The sign-in approval page shows a name the asking computer chose. |
| [C-4](./c-4-cloud-deploy-can-use-untested-acorn-revision.md) | Medium | The cloud deploy can use a different Acorn revision from CI. |
| [R-6](./r-6-previews-put-the-cloud-inside-tls.md) | Medium, latent | Previews put the account service inside the encryption, and the service takes a preview challenge on the relay credential alone. |
| [D-4](./d-4-relay-build-context-can-include-local-secret-files.md) | Medium, conditional | The manual relay deploy can send a working checkout's credential files. |
| [G-3](./g-3-dev-tunnel-exposes-test-mode.md) | Medium, only with `TEST_MODE=1` | The Slack dev tunnel can publish the service's test routes. |
| [C-2](./c-2-email-sign-in-timing-shows-allowlist.md) | Low | The email sign-in page answers slower for an address on the allowlist. |
| [G-4](./g-4-sent-link-ties-slack-user-to-wrong-node.md) | Low | A link page someone sends you ties your Slack user to their Node. |
| [R-7](./r-7-phone-rules-skip-plugin-routes-and-the-socket.md) | Low | The Slack link page finishes a link for whoever has its code. |
| [G-5](./g-5-new-holder-edits-earlier-bot-messages.md) | Low | A Node that takes over a thread can edit the bot's earlier messages in it. |
| [G-6](./g-6-one-node-spends-team-rate-limit.md) | Low | One Node can use up a workspace's whole Slack rate limit. |

The ID's letter names the area. X covers the chain across areas, G the hosted Slack gateway, S the
Slack plugin, C the account service, R remote access, L the local Node, and D release and deployment.

Earlier references to R-3, S-2, and S-3 belong to X-1. S-4 belongs to G-1. G-2 belongs to S-1.

## Verification and coverage

Two hundred existing tests passed across Slack, agent execution, cloud sign-in, relay, pairing,
and Node authorization. Test coverage and source inspection support the findings at the stated
confidence. Production deployment, live Slack installation eligibility, and end-to-end unauthorized
command execution remain unverified.

Three follow-up reviewers traced paths outside the initial review.

| Area | Checked in source | Still open |
| --- | --- | --- |
| Desktop, extension, and renderer | Native command admission, external navigation, markup rendering, extension messages and gestures, and remote preview isolation. | Verify permission cards in Slack and review phone and terminal approval views. Test native webview isolation in packaged builds on each platform. |
| Loaded plugins, workflows, and agent tools | Capability access, frame scopes, workflow digest approval and trigger review, and the ordering of tool permission and ceiling checks. | Audit the other privileged capabilities, loaded tools' self-declared risk, and provider-specific MCP approval paths. |
| Release and deployment | Desktop signing, the bundled Node runtime, standalone packaging, and the hosted phone and relay build inputs. | Verify GitHub branch and environment rules, preview deploy token scope, and the provenance of a published build. Inspect an image produced by the documented manual relay deployment. |

The [webview security page](../../security/webviews.md) still describes previews as local-only.
`packages/custody/src/broker/previewProxy.ts` now provides a helper for remote previews. Use that
boundary when planning the packaged webview checks.

Once a finding is fixed, delete its file and record the fix in a dated review under
[docs/security/](../../security/), as [the November 20 review](../../security/review-2026-11-20.md) did.
