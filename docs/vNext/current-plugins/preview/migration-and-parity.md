# Preview migration and parity

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-PREVIEW`

## V1 coupling removal

| V1 behavior/coupling | Required V2 replacement |
| --- | --- |
| Client imports Terminal `runClient` | optional `acorn/terminal.run-targets@2` dependency |
| Preview mode/value/rules live in core `repo_paths` | isolated Preview settings/resources |
| `/bin/sh -c <previewValue>` | named structured config-trusted core command |
| renderer calls `window.acorn.preview` | typed host/native renderer capability |
| service RPC calls Electron preview/browser methods | authenticated selected-Client view protocol |
| Electron main queries service DB for rules | bounded rule snapshot by binding/policy generation |
| page rule uses `executeJavaScript` | fixed CDP DOM/input operations |
| browser tools wired from application composition | exported Preview capabilities consumed by Agents |
| task archive fires a private Client event | core task lifecycle subscription |
| single task ID identifies view globally | Client+Node+task+view-session binding |
| native view uses implicit browser partition | unique ephemeral isolated partition |

`CUR-PREVIEW-120` No core, Terminal, Agents or other plugin module may import Preview
implementation code. Native operations are versioned Electron-host contracts; Node collaboration
uses brokered dependencies.

`CUR-PREVIEW-121` V1 preview database fields, rules, current URLs, browser state, cookies, console,
snapshots and public API tokens are not imported. V1 data and browser profiles remain untouched.

`CUR-PREVIEW-122` The allowed configuration importer may copy fixed `url` and valid `port` values
into the new isolated database after owner review. It records source and creates no view.

`CUR-PREVIEW-123` A V1 `script` value is not executed or translated into a shell command. Import
creates a disabled diagnostic directing the owner to define a named structured command and
acknowledge the exact repository config hash.

## Fresh-install sequence

1. Installer verifies the Node/declarative artifacts and compatible Electron built-in capability.
2. Node opens the isolated empty database; Electron registers the pane/native renderer.
3. Opening Preview resolves recipe/run-target/config sources for the task.
4. With no source, the configuration empty state is shown.
5. With a valid target, Node issues a short-lived policy and Electron creates an isolated view.
6. Agent driving remains disabled until the owner grants it and selects this live view.

`CUR-PREVIEW-124` Fresh Preview MUST NOT run a command, start a target, open a page, reuse browser
cookies or enable Agent driving merely because the plugin was installed.

## Visual and behavioral parity

`CUR-PREVIEW-125` Preview appears with V1 label, globe glyph, order, `Cmd+Shift+B`, 320 px minimum,
DOM retention semantics and standard task-pane controls.

`CUR-PREVIEW-126` The chrome retains Back, Forward, Stop/Reload, Home, editable address, DevTools
and loading indicator. V2 additionally displays origin and safe external-open; these do not reduce
the existing controls.

`CUR-PREVIEW-127` Fixed URL and port configuration resolve to the same home outcomes. URL priority
retains recipe override, active default run-target URL and repository/owner configuration in that
order, now through contracts.

`CUR-PREVIEW-128` A named structured command preserves the user-visible script use case: run in
the task worktree, read the last non-empty stdout URL, enforce 10-second timeout and report failure.
Raw V1 shell strings are the explicit security removal.

`CUR-PREVIEW-129` The native page survives ordinary pane and task switches with history, scroll and
form state while its lease and memory policy permit; it is hidden under overlays and only the
active task's view is visible.

`CUR-PREVIEW-130` Home follows target revision; changed run target updates the authorized home.
Changing home does not silently reset an actively browsed page unless the original recipe declared
that behavior.

`CUR-PREVIEW-131` HTTP(S)-only, no-user-info navigation and popup denial are preserved. V2 adds
redirect/DNS/subresource/permission enforcement and unique partition isolation.

`CUR-PREVIEW-132` Load-triggered fill rules retain enabled flag, URL matching, selector/value
behavior and SPA-render delay tolerance. V2 performs fixed CDP input, binds secret values safely
and exposes rule failure without page-code injection.

`CUR-PREVIEW-133` Agent browser tools retain navigate, accessibility snapshot with `eN` refs,
click, fill, screenshot and 200-line console behavior against the same visible page. V2 makes
Client selection, approval, limits and audit explicit.

`CUR-PREVIEW-134` A no-target pane, desktop-required fallback, loading/navigation state, task
archive eviction, view crash and DevTools owner restriction preserve or strengthen V1 behavior
without orphan views.

## Remote and fleet behavior

`CUR-PREVIEW-135` For a bundled local Node, direct local HTTP targets behave like V1. For a remote
Node, Node-local targets use the authenticated task-scoped tunnel and are labeled as remote.

`CUR-PREVIEW-136` Identical task IDs or URLs across Nodes create distinct partitions, policies and
bindings. Browser state is never shared across Nodes or Clients.

`CUR-PREVIEW-137` Disconnect disables navigation, rules and Agent driving and never buffers
actions. Reconnect re-resolves target/policy and requires explicit view rebind.

`CUR-PREVIEW-138` A Client without Electron native support may display safe target metadata or
external open but does not affect Node plugin health or prevent headless target resolution.

## Uninstall, update and failure

`CUR-PREVIEW-139` Uninstall destroys all guest views/partitions, revokes bindings, closes DevTools,
removes contributions and retains or purges configuration as chosen. Terminal targets continue
running unless separately stopped by their owner.

`CUR-PREVIEW-140` Reinstall restores retained configuration and inert layout position, creates no
view until active, and never restores browsing state, cookies, Agent refs or page credentials.

`CUR-PREVIEW-141` Client update or rollback closes active views at a visible boundary and verifies
the provider declaration against the new built-in capability before reopen. A missing/incompatible
allowlisted capability yields the desktop-required fallback, not plugin-supplied native code.

`CUR-PREVIEW-142` Node resolution failure, Terminal absence, command denial/failure, target
unreachability, tunnel failure, native crash, policy expiry and page navigation denial each remain
separate health and UI states.

## Release acceptance

`CUR-PREVIEW-143` Parity tests compare V1 and V2 local tasks for pane placement, URL precedence,
chrome, navigation/history, state retention, overlays, rules, archive eviction, DevTools and all
six Agent browser operations.

`CUR-PREVIEW-144` Remote tests use a Node-only localhost service and prove tunnel reachability,
origin labeling, exact target restriction, two-Client isolation, disconnect and revocation.

`CUR-PREVIEW-145` Security tests cover raw script refusal, structured-command injection,
URL/parser/redirect/DNS attacks, guest isolation, forbidden permissions/protocols, page-rule
injection, CDP escape, stale refs and artifact substitution.

`CUR-PREVIEW-146` Lifecycle tests cover install partial failure, Node-only availability, built-in
Client capability absence, active-view update, task archive, window close, crash loops, quarantine,
retain/purge uninstall and rollback.

`CUR-PREVIEW-147` Boundary tests reject direct Terminal/Agents imports, database access from
Electron, Electron handles in Node, remote executable UI, ambient network/process/secret access and
Agent use without delegated view authority.

`CUR-PREVIEW-148` Accessibility tests cover browser chrome and all empty/error states; guest page
accessibility remains page-owned and snapshots do not substitute for the owner's assistive access.

`CUR-PREVIEW-149` Preview is complete only when every V1 pane action, setting, page rule, preload
method, service RPC, public endpoint, browser tool and lifecycle edge has a V2 mapping or the raw
shell behavior is explicitly rejected as specified here.
