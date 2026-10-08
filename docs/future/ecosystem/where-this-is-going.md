# Related plugin work

Date: October 8, 2026. Status: direction; implementation status belongs to the linked handoffs.

Use this page to find separate work that affects plugin distribution. Each linked plan owns its
requirements, dependencies, and acceptance. Implemented contracts remain in the reference docs.

| Work | Starting point and next step |
| --- | --- |
| Security hardening | Worker isolation is implemented. [Security requirements](../security/README.md) proposes intrinsic protection, a runtime backstop, and additional agent-tooling checks. |
| Compiled plugin migration | [The migration assessment](../compiled-tier.md) records candidates and their actual host dependencies. Editor needs PTY, persistence, and multi-document contracts; bundle size is not its blocker. |
| Signing and discovery | Published authoring packages and compatibility checks are implemented. [Distribution work](./work-plan.md) covers attestation and then listing. |
| Repository extraction | [Package extraction](../split.md) covers outside builds, artifact pinning, reconciliation, and cross-repository development. |
| Control plane | [Node enrollment](../../node-enrollment.md) and [Node providers](../../plugins/node-providers.md) are implemented extension contracts. [Cloud](../cloud/README.md) proposes the hosted service that uses them. |
| Browser and mobile clients | [Remote access](../remote.md) proposes browser sessions, transport, plugin custody, and a mobile subset. The platform adapter is implemented. |

## Verify before building

- Read the linked owner instead of treating a direction as an implementation specification.
- Confirm prerequisites and open acceptance against the target checkout and dated evidence.
- Keep package identity, host authority, and client custody explicit when work crosses these owners.
