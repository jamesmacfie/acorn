# Settings and setup wizards

Status: Normative<br>
Requirement prefix: `PLUG-SETUP`

Settings are typed scoped values. Setup is a Node-owned resumable state machine rendered by a
client. Permission prompts and secret handling remain host-owned regardless of plugin UI.

## Settings definitions

Each definition contains `id`, `label`, `description`, `type`, `scope`, `default`, `validation`,
`sensitivity`, `restartEffect`, `visibility`, `writeCapability`, and optional `migration`.

Supported types are boolean, bounded integer/number, bounded string, enum, string list, structured
object with closed schema, duration, color token, keybinding, resource reference, secret reference
and provider connection reference.

- **PLUG-SETUP-001:** Settings MUST validate on the Node before persistence. Client validation is
  advisory and uses the same signed schema.
- **PLUG-SETUP-002:** Definitions cannot run plugin code for validation, defaulting, visibility or
  migration. Cross-field validation uses a bounded declarative rule set or a separately declared
  validation command with no write authority.
- **PLUG-SETUP-003:** A secret setting stores only a secret reference and write status. It has no
  default, read-back, copy, interpolation, export, telemetry value or error echo.
- **PLUG-SETUP-004:** Changing a setting declares one effect: `live`, `restart-runtime`,
  `restart-view`, `rerun-setup`, or `reinstall`. The host shows the effect before commit.

## Scope and precedence

Precedence from least to most specific:

1. plugin default;
2. Fleet-owner policy;
3. Node;
4. workspace;
5. repository;
6. task;
7. plugin installation;
8. paired client presentation setting.

- **PLUG-SETUP-005:** A definition lists the scopes at which it is legal. Client presentation
  settings cannot alter Node execution, credentials, grants, provider state or shared workspace
  behavior.
- **PLUG-SETUP-006:** Explicit unset reveals the next less-specific value. Reset and set-to-default
  are distinct operations and shown distinctly.
- **PLUG-SETUP-007:** Effective values include provenance for authorized clients: definition
  default or exact scope, revision and last-changed time. Secret provenance omits value and secret
  metadata beyond presence/health.
- **PLUG-SETUP-008:** Concurrent writes use setting revision. A conflict preserves both submitted
  and current values in the host conflict UI, except secrets, whose submitted plaintext is discarded
  after the attempt.
- **PLUG-SETUP-023:** A `fleet-owner` value that affects Node behavior is a desired baseline, not a
  hidden Fleet server. Electron stores the desired revision and applies it as separate idempotent
  commands to selected Nodes; each Node persists and authorizes its own copy. Partial success is
  visible per Node, and there is no cross-Node transaction or authority inferred from the Client
  copy.
- **PLUG-SETUP-024:** A client-only declarative plugin MAY own a `fleet-owner` presentation value in
  `fleet.sqlite` without a Node installation. Such a value can aggregate labels, layouts or
  navigation but cannot control Node execution, permissions, credentials, provider state or shared
  workspace data.
- **PLUG-SETUP-025:** A settings definition declares its authoritative owner as
  `node-behavior` or `client-presentation`. `client-device` is valid only for the latter. A
  `node-behavior` definition cannot read a merely desired Client copy; the Node's acknowledged
  revision is authoritative.

## Wizard definition

The machine schema is
[`setup-wizard-v2.schema.json`](../contracts/schema/setup-wizard-v2.schema.json). A wizard declares:

| Field | Rule |
| --- | --- |
| `id`, `version` | stable namespaced identity and positive version |
| `purpose` | install, connect, repair, migrate, reauthorize or uninstall |
| `scope` | one Node installation and optional workspace/resource |
| `entry`, `steps` | explicit finite state graph |
| `activationGate` | none, required, or required-capabilities list |
| `resumePolicy` | compatibility rules across plugin updates |
| `cancelPolicy` | persisted state and cleanup semantics |
| `completion` | validated postconditions and next action |

- **PLUG-SETUP-009:** The graph MUST be finite, have one entry, at least one completion, no
  unreachable step and no automatic cycle. User retry cycles are explicit and bounded by policy.
- **PLUG-SETUP-010:** The Node persists wizard instance ID, definition coordinate/version, lifecycle
  revision, current step, non-secret validated answers, secret references, completed effects,
  validation outcomes, timestamps and resumable error.
- **PLUG-SETUP-011:** A client sends step input with instance and step revision. Stale, repeated or
  out-of-order transitions cannot overwrite newer state.

## Standard steps

| Kind | Host behavior |
| --- | --- |
| `information` | trusted title/body, links through safe navigation |
| `permissions` | host permission comparison and grant/deny |
| `form` | standard renderer over typed settings/input |
| `secret` | secure write-only entry into owning Node vault |
| `oauth-device` | system browser/device flow with state, PKCE and callback binding |
| `resource-selection` | authorized bounded search/select of typed resources |
| `validation` | side-effect-free declared command with safe result |
| `async-operation` | durable job with progress, cancellation and retry |
| `confirmation` | host summary and risk-specific confirmation |
| `completion` | success/partial/failure effects and navigation choices |

- **PLUG-SETUP-012:** Permission, secret, OAuth and risk confirmation steps are always host-rendered.
  A plugin can supply labels/reasons but cannot style, overlay, preselect approval or observe secret
  plaintext.
- **PLUG-SETUP-013:** OAuth uses external system browser or verified device flow. State is
  single-use, expiry-bound, Node/installation/client-bound and PKCE-protected where the provider
  supports it. Callback destinations are fixed Acorn endpoints.
- **PLUG-SETUP-014:** Resource selection queries are authorized, paginated and type constrained.
  A submitted resource is revalidated on the Node and cannot escape the wizard scope.
- **PLUG-SETUP-015:** Async steps persist job identity before dispatch, report bounded monotonic
  progress, support reconnect and distinguish cancellation requested, cancelled, committed and
  outcome unknown.
- **PLUG-SETUP-016:** Validation errors map to fields or a safe step-level issue. Raw provider
  payloads, stack traces, URLs with credentials and filesystem paths are redacted.

## Resume, cancel and completion

- **PLUG-SETUP-017:** Closing Electron does not cancel. Reopening any authorized owner client shows
  the same resumable wizard state from the Node.
- **PLUG-SETUP-018:** Cancellation states exactly which settings, secret references, external
  effects, downloaded artifacts and plugin data remain. Cleanup is an explicit idempotent command.
- **PLUG-SETUP-019:** Completion is committed only after all required postconditions are checked:
  grants exist, referenced secrets/connections are healthy, required resources still exist and
  activation health may proceed.
- **PLUG-SETUP-020:** An update may reuse completed setup only when its manifest declares compatible
  wizard versions and the Node verifies postconditions. Otherwise a migration/repair wizard blocks
  activation.
- **PLUG-SETUP-021:** Setup telemetry records step kind, duration and outcome only; no answers,
  resource names, secret metadata, provider responses or bespoke UI content.

## Acceptance

- **PLUG-SETUP-022:** Tests MUST cover every step kind, refresh/reconnect, two-client conflict,
  secret rejection, OAuth state replay, resource substitution, async crash/restart, cancellation at
  every step, plugin update mid-wizard, stale revisions, accessibility and keyboard-only completion.
