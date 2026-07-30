# Preview Node and data model

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-PREVIEW`

## Configuration resources

| Resource | Durable fields |
| --- | --- |
| `acorn.preview.configuration` | repository URI, mode, value/command ref, source, revision |
| `acorn.preview.browser-rule` | repository URI, enabled, URL pattern, trigger, action, value ref |
| `acorn.preview.target` | task URI, resolved home URL/policy, source, expiry, observed revisions |
| `acorn.preview.view-binding` | ephemeral Client/view relation, policy generation and lease |

`CUR-PREVIEW-020` Configuration mode is `none`, `url`, `port`, `command` or `run-target`.
`url` stores a normalized absolute HTTP(S) URL; `port` stores an integer 1–65535; `command`
references a named structured core command; `run-target` references a Terminal target ID.

`CUR-PREVIEW-021` A raw shell string is not a valid V2 configuration value. V1 `script` remains
recognizable only to produce a migration-required diagnostic and replacement instructions; it is
never executed by V2.

`CUR-PREVIEW-022` Effective configuration precedence is: signed layout-recipe session override;
active default Terminal run-target URL; trusted repository `.acorn/config.toml`; owner
repository-scoped plugin setting; Node-scoped default; `none`. The resolved target names its source
and every source revision.

`CUR-PREVIEW-023` A layout recipe may select only a declared run target or fixed target resource.
It cannot embed credentials, JavaScript, arbitrary command text or a browser policy broader than
the installation grant.

`CUR-PREVIEW-024` Repository configuration is read through core's hash-gated configuration
snapshot. A changed executable command or browser rule requires exact snapshot acknowledgement
before use, even when a prior version was trusted.

## Target resolution

`CUR-PREVIEW-025` `preview.target.resolve@2` accepts one task URI and optional recipe override. The
Node derives repository/worktree and evaluates the precedence chain without trusting Client-sent
paths, ports, run status or URL.

`CUR-PREVIEW-026` Fixed URL mode returns the normalized URL after scheme, user-info, host, port and
policy validation. Port mode returns `http://localhost:<port>` as a logical Node-local target, not
the Client's loopback.

`CUR-PREVIEW-027` For a remote Node, `localhost` denotes the Node host. The target descriptor
therefore includes reachability `client-direct|node-tunnel-required|unreachable`; Electron MUST NOT
silently interpret it as Client loopback.

`CUR-PREVIEW-028` V2 direct-remote support requires a preview tunnel when the target is reachable
only from the Node. The tunnel is a core authenticated byte relay bound to exact task, target,
Client and policy; it is not an open proxy and exposes a Client-local opaque origin.

`CUR-PREVIEW-029` Command mode invokes only the referenced core command with structured fixed
arguments, task cwd handle, minimal environment, 10-second deadline, 64 KiB combined-output limit
and cancellation. The last non-empty stdout line must be one valid authorized HTTP(S) URL.

`CUR-PREVIEW-030` Terminal resolution calls the optional dependency under delegated authority.
Start is explicit: viewing Preview may read a running target URL but MUST NOT auto-start a stopped
target unless a signed layout recipe or owner action requested start.

`CUR-PREVIEW-031` Resolution does not persist browsing history or current page. A target snapshot
is cacheable for at most 30 seconds and invalidated by configuration, run-target, task, checkout,
permission or network-policy changes.

## Browser rules

A rule contains `id`, `enabled`, bounded `urlPattern`, trigger `load`, and action:

- `fill` with a bounded safe selector and literal non-sensitive value; or
- `fill-secret` with an opaque secret reference, exact destination origin and purpose.

`CUR-PREVIEW-032` Rule IDs are unique per repository. Patterns are parsed by a bounded host
matcher; they are not JavaScript regular expressions. Selectors use a documented safe subset and
are capped at 1 KiB.

`CUR-PREVIEW-033` Rules are evaluated against the final committed top-level URL after navigation
policy. The Client rechecks view ID, policy generation and current URL after any asynchronous Node
lookup before applying an action.

`CUR-PREVIEW-034` Load rules run after DOM readiness and at most once per
`(ruleId,policyGeneration,navigationId)`. SPA route changes do not trigger them unless a future
declared trigger version explicitly says so.

`CUR-PREVIEW-035` A `fill-secret` value is delivered as a one-use Client-native operation through
the credential broker and is never returned to Node plugin code, renderer JavaScript, page script,
events, console or diagnostics.

`CUR-PREVIEW-036` Fill uses trusted CDP DOM/input primitives against the resolved element. V2 MUST
NOT construct or execute page-authored JavaScript from selectors or values.

## Isolated database

| Table | Purpose |
| --- | --- |
| `p_configurations` | Node/repository settings and revision |
| `p_browser_rules` | normalized rule definitions and secret references |
| `p_import_diagnostics` | non-secret V1/config migration outcomes |
| `p_resolution_health` | bounded last result/error per repository source |

`CUR-PREVIEW-037` Plugin tables contain canonical core resource URIs, not duplicated task,
repository or workspace ownership. Foreign resource existence is revalidated through core.

`CUR-PREVIEW-038` Target URLs are sensitive operational metadata. Only configuration URLs are
durable; resolved run/command URLs, signed tunnel URLs, current pages, console, snapshots and
screenshots are ephemeral and excluded from database, events, telemetry and backup.

`CUR-PREVIEW-039` Application-encrypted backup includes non-secret configuration, rules and opaque
secret references. It excludes target caches, current pages, browser profiles, cookies, cache,
console, snapshots and screenshots.

`CUR-PREVIEW-040` Restore validates referenced repositories, secret refs, command IDs and rule
policy. Missing references become disabled recoverable rows; restore never opens a page or runs a
command.

`CUR-PREVIEW-041` Default quota is 16 MiB database and 32 MiB transient resolution data. Browser
profile/cache quotas are enforced by Electron per view/session and cleared at teardown.

`CUR-PREVIEW-042` Purge deletes database/configuration and asks core to delete plugin-created
secrets according to vault reference ownership. Retain disables rules and preserves encrypted
configuration for reinstall.

## View bindings

`CUR-PREVIEW-043` A view binding is an ephemeral lease containing Client device ID, Node/task URI,
view-session ID, target/policy generation, created/expiry time and allowed operation set. It
contains no Electron or CDP handle.

`CUR-PREVIEW-044` A Client may own at most one live Preview view per node-qualified task and 16
live views total by default. Electron may suspend hidden views under memory pressure and reports
the state through the typed view session.

`CUR-PREVIEW-045` View bindings expire after 10 minutes without authenticated heartbeat or
immediately on revocation, task archive, target-policy change, Client disconnect, plugin disable
or native adapter restart.

`CUR-PREVIEW-046` Rebinding never transfers page state between Clients. A second Client gets a new
isolated view and target policy even when it displays the same task.

`CUR-PREVIEW-047` Browser page state is not backed up or restored. After Electron restart, Preview
opens the resolved home only when the pane is active; it does not restore form content, history or
authentication cookies.

`CUR-PREVIEW-048` Node restart reconciles no browser process. It expires old bindings and requires
each Client to reopen a view under a fresh target snapshot and policy.

`CUR-PREVIEW-049` Data tests MUST cover precedence, command/run dependency absence, config trust,
remote localhost/tunnel behavior, rule revisions, secret refs, restore, target expiry, task archive
and multi-Client isolation.
