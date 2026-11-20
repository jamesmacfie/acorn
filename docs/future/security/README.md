# Security findings from November 20, 2026

The November 20, 2026 review looked for ways to run code on a user's Node without their approval.
The Slack, account service, relay, and Node findings cite Acorn `90b9e61e3` and
`acorn-cloud` `19fa594`. Each open finding has one report with its evidence, fix, and
verification requirements.

## Where to start

Fix [X-1](./x-1-account-takeover-to-slack-agent-turns.md) first. Require an approved Slack identity
on the Node and enforce an execution policy for its turns. Address the independent account
sign-in weakness in [C-3](./c-3-email-code-budget-resets.md) and the child-agent permission
escalation in [L-3](./l-3-delegation-can-widen-harness-permissions.md).

## The findings

| ID | Severity | Finding | Repository |
| --- | --- | --- | --- |
| [X-1](./x-1-account-takeover-to-slack-agent-turns.md) | Critical | The cloud account can authorize Slack turns that can reach command execution on the Node. | Both |
| [C-3](./c-3-email-code-budget-resets.md) | High | Email sign-in attempts reset across code issuances. | acorn-cloud |
| [L-3](./l-3-delegation-can-widen-harness-permissions.md) | High | A delegated agent can receive a less restrictive execution policy than its parent. | acorn |
| [L-4](./l-4-loaded-plugins-can-use-privileged-capabilities.md) | High | Loaded plugins can reach host terminal and cloud account authority. | acorn |
| [G-1](./g-1-click-on-another-card-approves.md) | High, conditional | The Node accepts approvals without checking the original card. | Both |
| [R-1](./r-1-account-website-runs-code-through-a-phone.md) | High | A breached account website runs code on the Node through a paired phone. | acorn |
| [R-2](./r-2-account-service-relays-a-pairing-and-keeps-the-token.md) | High | A breached account service relays a pairing and keeps the device token. | acorn |
| [S-1](./s-1-thread-guests-steer-agent-and-read-answers.md) | Medium | Guest replies and thread history can influence the owner's agent. | Both |
| [C-1](./c-1-phone-approves-its-own-pairing.md) | Medium | A phone can approve its own pairing request and get a full device. | acorn |
| [L-1](./l-1-loaded-plugin-makes-trusted-projects.md) | Medium | A loaded plugin can make a trusted project and run code outside its sandbox. | acorn |
| [L-5](./l-5-permission-cards-can-omit-command-text.md) | Medium | An approval card can omit part of the command it authorizes. | acorn |
| [C-4](./c-4-cloud-deploy-can-use-untested-acorn-revision.md) | Medium | The cloud deploy can use a different Acorn revision from CI. | acorn-cloud |
| [D-1](./d-1-standalone-release-resolves-unreviewed-dependencies.md) | Medium | Standalone packaging can resolve dependencies outside the reviewed lockfile. | acorn |
| [D-2](./d-2-manual-builds-receive-updater-signing-key.md) | Medium, latent | Manual desktop builds receive the updater signing key. | acorn |
| [D-4](./d-4-relay-build-context-can-include-local-secret-files.md) | Medium, conditional | A manual relay build can include local credential files. | Both |
| [G-3](./g-3-dev-tunnel-exposes-test-mode.md) | Medium, only with `TEST_MODE=1` | The Slack dev tunnel can publish the service's test routes. | acorn-cloud |
| [L-2](./l-2-read-block-exposes-relay-credential.md) | Low | An agent in the read block can read the Node's relay credential. | acorn |
| [C-2](./c-2-email-sign-in-timing-shows-allowlist.md) | Low | The email sign-in page answers slower for an address on the allowlist. | acorn-cloud |
| [G-4](./g-4-sent-link-ties-slack-user-to-wrong-node.md) | Low | A link page someone sends you ties your Slack user to their Node. | acorn-cloud |
| [G-5](./g-5-new-holder-edits-earlier-bot-messages.md) | Low | A Node that takes over a thread can edit the bot's earlier messages in it. | acorn-cloud |
| [G-6](./g-6-one-node-spends-team-rate-limit.md) | Low | One Node can use up a workspace's whole Slack rate limit. | acorn-cloud |
| [R-4](./r-4-sign-out-leaves-phones-paired.md) | Low | Signing out of the account leaves phone devices paired. | acorn |
| [R-5](./r-5-revoke-leaves-proxied-sockets-open.md) | Low | Revoking a device leaves in-flight requests and proxied sockets open. | acorn |
| [D-3](./d-3-desktop-runtime-lacks-independent-digest.md) | Low | Desktop runtime verification trusts the download source. | acorn |
| [S-5](./s-5-gateway-token-lifetime-not-capped.md) | Info | The Node doesn't enforce the gateway token's 60-second lifetime. | acorn |

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
[docs/security/](../../security/), as earlier reviews such as
[the October 22 review](../../security/review-2026-10-22.md) did.
