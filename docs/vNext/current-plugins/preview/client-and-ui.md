# Preview Client and UI

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-PREVIEW`

## Pane contribution

`CUR-PREVIEW-050` Preview contributes task pane `acorn/preview.pane.preview` with label “Browser
preview”, globe glyph, order 80, default `Cmd+Shift+B`, minimum width 320 px and `dom` retention.
Host pane show/add/close/pin/move/resize/focus/maximize behavior remains standard.

`CUR-PREVIEW-051` The signed renderer-provider requests Electron's allowlisted
`acorn.browser-preview/2`. Missing native capability displays a desktop-required state explaining
that Node configuration remains available; future mobile may show target metadata and a safe
external-open intent.

`CUR-PREVIEW-052` With no resolved target, the pane shows “No preview URL yet” and actions to open
repository Preview settings or inspect/start eligible run targets. It does not fabricate a
localhost default.

## Native browser chrome

`CUR-PREVIEW-053` Host chrome remains outside the guest view and exposes Back, Forward,
Stop/Reload, Home, editable URL field, visible origin, loading indicator, open-external and
developer-tools action. Guest content cannot cover or imitate the host chrome.

`CUR-PREVIEW-054` Back/Forward enablement and loading/current URL update from typed native state
for the exact view session. Late events from another task, Client, Node, policy generation or
destroyed view are discarded.

`CUR-PREVIEW-055` Enter in the URL field creates a typed navigation request. A value without a
scheme is proposed as `https://`; Electron displays the normalized destination and Node/policy
decision before navigation when the origin broadens.

`CUR-PREVIEW-056` Home navigates to the currently authorized resolved target, not the first URL
ever opened. A target revision change updates Home but does not navigate an active view until the
owner chooses Home or a signed layout recipe requires reset.

`CUR-PREVIEW-057` DevTools opens detached only from a direct owner gesture and only when Node and
Client developer policy permit it. It is visibly a local diagnostic surface and does not grant an
Agent additional browser authority.

## View creation, bounds and visibility

`CUR-PREVIEW-058` Electron creates one sandboxed `WebContentsView` per live binding with a unique
nonpersistent partition, no preload, `nodeIntegration=false`, `contextIsolation=true`, sandbox
enabled, no Acorn cookies and all Chromium permissions denied by default.

`CUR-PREVIEW-059` Bounds are rounded finite values derived from the host pane; negative dimensions
become zero. Only the owner Electron window may set bounds, show, hide, navigate or destroy its
view.

`CUR-PREVIEW-060` At most one Preview native view is visible per Electron window. Pane/task/Node
switch, minimize, occlusion, modal/palette overlay and window blur policy hide it without
reparenting or granting guest focus.

`CUR-PREVIEW-061` The host uses an authoritative overlay state rather than polling one DOM point.
Native view visibility changes in the same presentation transaction as modal/palette state so
guest pixels cannot cover security prompts.

`CUR-PREVIEW-062` Ordinary pane switches preserve page, scroll, form and navigation state while
the lease remains valid. Memory-pressure suspension may discard it and must show a labeled reload
state rather than pretending continuity.

`CUR-PREVIEW-063` Task archive, pane-session close with retention release, Client window close,
plugin disable/update/uninstall, view crash and policy revocation destroy the guest, detach the
debugger, clear the partition and invalidate every element reference.

## Navigation and page policy

`CUR-PREVIEW-064` Every initial load, typed navigation, redirect, in-page top-level navigation,
popup and external-protocol attempt is checked against the signed target policy. HTTP(S) user-info,
ambiguous hosts and disallowed schemes/ports/origins are rejected.

`CUR-PREVIEW-065` `window.open` is denied. A link requiring a new window becomes a host-mediated
external-open proposal that displays the full destination origin and never carries Acorn
credentials.

`CUR-PREVIEW-066` Downloads, clipboard, notifications, camera, microphone, geolocation, MIDI, USB,
serial, Bluetooth, screen capture, payment, file system, fullscreen and protocol handlers are
denied unless a separately specified host policy exists. Preview requests none by default.

`CUR-PREVIEW-067` Certificate errors fail closed. There is no generic “ignore TLS errors” plugin
setting. Development certificate exceptions, if later supported, are exact-origin, time-bounded,
owner-approved core policy.

`CUR-PREVIEW-068` The Node tunnel uses an opaque Client-local origin and authenticates every
request to the exact binding. It strips Acorn credentials and prohibits connection to targets
outside the resolved host/port after DNS and redirect revalidation.

## Agent-visible browser driving

`CUR-PREVIEW-069` Agent driving targets an owner-selected live binding and requires separate
actions `navigate`, `snapshot`, `click`, `fill`, `screenshot` and `console.read`. Merely opening
Preview grants none of them.

`CUR-PREVIEW-070` Snapshot returns a bounded accessibility tree and compact text. Actionable nodes
receive per-snapshot opaque references `e1`, `e2`, …; every new navigation, DOM epoch or snapshot
invalidates prior references.

`CUR-PREVIEW-071` Click and fill resolve only a reference from the latest snapshot, use trusted CDP
geometry/focus/input primitives, and return a typed stale-reference error. They accept no CSS
selector or page script from the Agent.

`CUR-PREVIEW-072` Screenshot is an authenticated bounded image artifact, not an unbounded data URI.
Console returns at most the newest 200 sanitized lines and declares truncation; source URLs, stack
frames and values are filtered for credentials.

`CUR-PREVIEW-073` Every Agent drive request appears in the same host approval/audit model as other
Agent tools and displays Node, task, Client, current origin, action and sensitivity. The page cannot
initiate or approve a tool call.

## Accessibility and fallback

`CUR-PREVIEW-074` Browser chrome is fully keyboard operable, has accessible names/state and returns
focus predictably. Guest keyboard capture cannot intercept reserved Acorn shell shortcuts or
security prompts.

`CUR-PREVIEW-075` Loading, target resolving, tunnel connecting, no target, permission denied,
navigation blocked, TLS failure, crashed view, disconnected Node, suspended view and unsupported
Client are separate standard states with actionable recovery.

`CUR-PREVIEW-076` Remote Node disconnection freezes the visible page only long enough to explain
the stale state, then disables navigation, rules and Agent controls. It never queues navigation or
fill for reconnect.

`CUR-PREVIEW-077` A Client without native preview may copy a non-secret target label or request
safe external open when policy permits. It never receives a tunnel credential merely to show an
unsupported state.

`CUR-PREVIEW-078` Renderer/native failures are contained to the view. Electron shell, Node,
Terminal target, Agents and other panes remain usable.

`CUR-PREVIEW-079` UI acceptance MUST cover chrome state, history, Home, URL normalization, overlays,
bounds, task switching, preserved state, suspension, every denied permission/navigation class,
remote tunnel, Agent driving, accessibility and unsupported/mobile fallback.
