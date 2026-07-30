# Preview verified plugin

**Status:** Normative current-plugin migration<br>
**Coordinate:** `acorn/preview`<br>
**Distribution:** Acorn Verified; independently versioned and installed by the default profile<br>
**Runtime:** WASI Node companion plus declarative `renderer-provider` contribution<br>
**Requirement prefix:** `CUR-PREVIEW`

Preview resolves a task's development URL, renders it in a hardened Electron `WebContentsView`,
and optionally lets an authorized Agent drive that exact visible view. It does not own tasks,
worktrees, run targets, process execution, Electron windows, Agent tools, or general network access.

This specification is divided into:

- [Node and data](./node-and-data.md)
- [Client and UI](./client-and-ui.md)
- [Contracts, events, and security](./contracts-events-and-security.md)
- [Migration and parity](./migration-and-parity.md)

The mandatory twelve-section template is distributed without omission: sections 1–3 and 9 are in
this overview; sections 4 and 8 are in Node/data plus Client/UI; sections 5–6 and 10 are in
Contracts/events/security; section 7 is in Client/UI; and sections 11–12 are in Migration/parity.

## Current behavior and authority

V1 contributes a `preview` task pane. Its home URL is chosen from a layout-recipe override, the
default live run target, then repository preview settings (`url`, `port` or a shell script whose
last output line is a URL). Electron main owns one `WebContentsView` per task, browser chrome,
navigation history, bounds, visibility, lifecycle, page-load fill rules and a CDP driver. Agents
can navigate, take an accessibility snapshot, click/fill the latest snapshot's element references,
capture PNG and read a 200-line console buffer.

The V1 Client imports Terminal's run client, core settings own Preview fields, the public API calls
back from Node to Electron, and script resolution invokes `/bin/sh -c`. V2 replaces these edges
with explicit optional capabilities and removes raw shell-string execution.

`CUR-PREVIEW-001` Preview MUST be an independently installable Acorn Verified package included in
the default profile. Its signed renderer-provider declaration activates only the
`acorn.browser-preview/2` implementation already shipped and allowlisted by a compatible Electron
build; the plugin ships no Electron-native executable.

`CUR-PREVIEW-002` The Node companion owns configuration, target resolution and target-policy
construction. Electron owns browser creation, partition, bounds, navigation, history, capture,
CDP and destruction.

`CUR-PREVIEW-003` A remote Node MUST NOT create a `WebContentsView`, send executable browser/UI
code, or receive a `webContents` identifier. It exchanges bounded target descriptors and typed
view-session commands with an explicitly selected paired Electron Client.

`CUR-PREVIEW-004` Electron MUST expose `acorn.browser-preview/2` to Preview only after verifying the
signed provider declaration and matching it to its build-time allowlist. Renderer support does not
authorize a Node, plugin or Agent to open, navigate, inspect or drive a view.

## Target ownership

| Concern | V2 owner |
| --- | --- |
| Repository/task identity and worktree | Node core |
| Preview settings and browser rules | Preview Node companion |
| Run target state and URL | optional `acorn/terminal` capability |
| Structured command execution for URL resolution | core process/config-trust broker |
| URL resolution and target policy | Preview Node companion |
| Pane, chrome and view-session presentation | Preview Electron contribution |
| `WebContentsView`, partition, CDP and permissions | Electron native adapter |
| Agent command authorization/tool projection | Agents plus core capability broker |
| Browser page state, history, form input and console ring | ephemeral Electron state |

`CUR-PREVIEW-005` Preview MUST NOT call Terminal implementation code. The optional
`acorn/terminal.run-targets@2` dependency supplies default target snapshot/start/URL operations.

`CUR-PREVIEW-006` Preview MUST NOT implement generic command execution. URL command resolution uses
a named, structured, config-trusted core command capability and receives only bounded stdout.

`CUR-PREVIEW-007` Browser state is owned by one `(clientDeviceId,nodeId,taskId,viewSessionId)`.
There is no fleet-global “current browser” and an Agent cannot guess which paired Client to drive.

## Manifest and permissions

The manifest declares:

- a WASI Node runtime, isolated settings database, schemas and migrations;
- a signed declarative provider selecting Electron's built-in browser capability;
- task pane, settings, query, action, navigation, view-session and optional Agent tool contracts;
- required task/repository/config/storage/UI/event contracts;
- optional Terminal run-target and Agents tool dependencies; and
- no raw secret, arbitrary process, ambient network or bespoke UI artifact.

`CUR-PREVIEW-008` Baseline grants are `core.task:read`, `core.repository:read`,
`core.storage:own`, declared config snapshots, exact event subscriptions and declared `core.ui`.
Fixed URL resolution requests no process capability.

`CUR-PREVIEW-009` Structured command resolution separately requests a command-ID allowlist,
task-root cwd, empty/minimal environment, 10-second deadline and 64 KiB stdout ceiling. Agent
driving separately requests a task/view-scoped browser-control grant.

`CUR-PREVIEW-010` Browser navigation is not the Node's general `core.network` capability. The
Electron native adapter enforces a target policy for top-level navigation, redirects, subresources,
permissions and external actions.

## Lifecycle and health

`CUR-PREVIEW-011` Activation migrates isolated configuration, validates rule schemas, negotiates
and allowlist-checks the built-in native renderer, and registers contributions without opening a
browser or resolving a task.

`CUR-PREVIEW-012` Health is reported independently for Node configuration/resolution, optional
Terminal/command dependencies, Electron native adapter and each active view session.

`CUR-PREVIEW-013` Preview has no mandatory setup wizard. The empty pane explains how to configure a
fixed URL/port or a Terminal run target and remains ready without a browser view.

`CUR-PREVIEW-014` Task archive, Client disconnect, owner-window close, plugin disable, artifact
update and uninstall MUST close the corresponding native view, detach CDP, revoke view handles,
clear page state and release the guest process.

`CUR-PREVIEW-015` A Node-companion failure leaves an existing view frozen/read-only only while its
current policy lease remains valid; navigation and Agent driving stop. An Electron-adapter failure
leaves Node configuration and other panes available.

`CUR-PREVIEW-016` Uninstall deletes plugin configuration only after the owner's retain/purge
choice, destroys every view and removes contributions. It never stops a Terminal run target or
deletes a worktree.

`CUR-PREVIEW-017` Updates stage the Node/declarative generation against the installed Electron
capability. Active views are closed after an owner-visible reload boundary; failed health gates
atomically restore the previous plugin generation and do not reopen pages until policy is
reauthorized.

## Compatibility invariants

`CUR-PREVIEW-018` Browser preview is a development surface, not general browsing, bespoke plugin
UI or a source of Acorn authentication. It has no Acorn cookies, preload, Node integration, shared
storage partition or ambient native bridge.

`CUR-PREVIEW-019` The exact parity, clean-start and intentional safety changes in
[Migration and parity](./migration-and-parity.md) are mandatory.
