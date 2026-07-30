# Permissions and capabilities

Status: Normative<br>
Requirement prefix: `PLUG-PERM`

Acorn uses deny-by-default, explicit, scoped capabilities. A manifest request is not a grant; the
owner and policy engine authorize an installation on one Node.

## Grant model

- **PLUG-PERM-001:** Effective authority is the intersection of manifest request, marketplace
  policy, Node policy, owner grant, caller delegation, resource policy and runtime enforcement.
- **PLUG-PERM-002:** A grant records installation generation, capability version, operation set,
  scope selector, constraints, prompt policy, granting actor, time, expiration and reason.
- **PLUG-PERM-003:** Required denial blocks activation with `permissions_required`. Optional denial
  disables only contributions and operations that list the capability.
- **PLUG-PERM-004:** Grants are not transferable across Nodes, installations, plugin versions with
  changed permission requests, clients, users or publisher identities.
- **PLUG-PERM-005:** An update that adds or broadens authority pauses before activation. Existing
  generation continues under its old grant until approval, disablement or security revocation.
- **PLUG-PERM-006:** Revocation takes effect immediately for new work, invalidates issued handles
  and cancels in-flight operations where safe. Post-commit outcomes remain recorded.

## Capability catalog

| Family | Example operations and mandatory constraints |
| --- | --- |
| `core.workspace` | read/list; exact workspace set |
| `core.repository` | metadata/status; exact repository set |
| `core.task` | read/create/update/archive; workspace/repository selector |
| `core.worktree` | list/read/create/open/adopt/remove; exact repository, core-managed path, dirty-removal and open-after-create policy |
| `core.file` | read/write/code-write/watch; rooted paths, glob subset, size, symlink policy |
| `core.git` | status/diff/branch/commit/fetch/push; repository, refs, remote, confirmation |
| `core.process` | fixed-tool/pty/spawn; executable, args, cwd, env, limits |
| `core.terminal` | list/read-output/send-input/create/close; task/profile/session |
| `core.agent` | read/prompt/approve/create/cancel; task, provider, tool set |
| `core.network` | HTTP request; scheme, host, port, method, redirects, DNS/IP, bytes |
| `core.secret` | reference/use/create/delete/raw; secret type, purpose, broker |
| `core.events` | publish/subscribe/replay; exact types, sensitivity, filters |
| `core.plugin` | call export/read status/request optional dependency; exact coordinate/export |
| `core.ui` | contribute/open/navigate/notify/attention; exact host surface |
| `core.clipboard` | read/write; format, user gesture, one-shot |
| `core.notification` | local notification; kind, rate, sensitivity |
| `core.storage` | own database/blob/temp; quota and class |
| `core.provider` | brokered provider operation; integration, account, purpose |

- **PLUG-PERM-007:** Capability coordinates and semantics are versioned. Unknown families,
  operations or constraint fields are denied.
- **PLUG-PERM-008:** `core.file.write` cannot modify executable repository configuration.
  `core.file.code-write` is separate and may trigger repository trust and owner confirmation.
- **PLUG-PERM-009:** Git push, destructive branch operations, terminal input, agent approval,
  and unrestricted process execution are high-risk operations with separate owner-visible grants
  and audit. Brokered credential use is shown separately by provider, purpose, operation and
  destination; it never grants the credential bytes.
- **PLUG-PERM-010:** `core.secret.raw` and the `acorn.secret.raw` spelling are not V2 capabilities
  and MUST be rejected in every plugin
  manifest, permission request, grant and lock, regardless of trust or runtime tier. A
  release-owned fixed-purpose credential helper is core implementation, cannot be named by a
  plugin, and is constrained by `SEC-AUTH-030` and `SEC-AUTH-031`.
- **PLUG-PERM-010A:** Contract validation MUST assert that
  [`capability-raw-secret-rejected.invalid.json`](../contracts/examples/capability-raw-secret-rejected.invalid.json)
  fails `capability-v2.schema.json#/$defs/permissionRequest` specifically because the capability ID
  is forbidden. No installer or approval UI may reinterpret this schema failure as a high-risk
  prompt.
- **PLUG-PERM-011:** Network constraints are rechecked after every redirect and DNS resolution.
  URL user-info, non-HTTP schemes, loopback/link-local/private addresses, metadata endpoints and
  ambiguous IP encodings are denied unless a dedicated capability names them.
- **PLUG-PERM-012:** Process arguments are structured values validated against a grammar. A shell
  string, inherited entire environment or unrestricted executable search path is not grantable.
- **PLUG-PERM-012A:** `capability-v2.schema.json` is the closed constraint-family registry. A
  platform capability ID begins `acorn.<family>` or `core.<family>` and MUST carry that family's
  discriminator; `core.events` is the compatibility spelling for the singular `event`
  discriminator. Repository, task, worktree, event, clipboard, notification, storage and provider
  requests MUST use their dedicated closed shapes. Generic key/value constraints are invalid.
- **PLUG-PERM-012B:** Contract validation MUST prove
  [`capability-family-confusion-rejected.invalid.json`](../contracts/examples/capability-family-confusion-rejected.invalid.json)
  is rejected because `core.task/2` carries `family: workspace`. The same family binding applies to
  requests and persisted grants and is repeated by the authorization broker before every use.

## Scope and precedence

Scopes narrow in this order:

`fleet > node > workspace > repository > task > resource > operation`.

- **PLUG-PERM-013:** A broader grant does not override a narrower explicit deny imposed by Node or
  resource policy.
- **PLUG-PERM-014:** A command targeting a task derives its owning Node/workspace/repository on the
  Node from authoritative state; it MUST NOT trust client-supplied ancestry.
- **PLUG-PERM-015:** Scope changes caused by task move, repository reassignment, workspace removal
  or provider relink invalidate affected handles and force reauthorization.

## Owner UX and audit

- **PLUG-PERM-016:** Permission prompts are host-rendered and group requests by risk, scope and
  purpose. Each group shows current versus requested authority, effects, persistence and denial
  consequence.
- **PLUG-PERM-017:** Install-time prompts SHOULD group routine read-only permissions but MUST
  separate secret use, external send, code write, Git push, process spawn, terminal input, agent
  approval, native execution and unrestricted code.
- **PLUG-PERM-018:** First-use and always-prompt decisions are persisted only as the declared
  policy; an always-prompt approval is one operation and cannot silently become durable.
- **PLUG-PERM-019:** Permission history records request, grant, denial, use of high-risk authority,
  change and revocation without recording secret values or sensitive request bodies.

## Conformance

- **PLUG-PERM-020:** Tests MUST prove denial for missing, expired, revoked, wrong-Node,
  wrong-installation, wrong-resource, widened-delegation and unknown capabilities.
- **PLUG-PERM-021:** Confused-deputy tests MUST make a low-authority plugin call a high-authority
  provider and prove the provider cannot use its own broader grant for the caller.
- **PLUG-PERM-022:** SSRF, path traversal, symlink race, command injection, inherited environment,
  secret-reference substitution and post-revocation handle tests are release gates.
