# Phase 2 — Trust, allowlists, and what the owner is told

**Size: S.** Requires [phase 1](./phase-1-surface-and-verbs.md). The consent half: a webview is a
new kind of grant, and the trust prompt has to say so in words that are true.

## Why this is its own phase

Every other third-party surface renders inside `app-plugin://<hash>` with
`connect-src 'none'` — the plugin's code runs, and it reaches nothing. A webview inverts both
halves: **the plugin's code does not run there, and the page it points at reaches the whole
network.**

That is not obviously worse, and it is genuinely different. Three consequences the prompt has to
account for:

1. **The plugin chooses what loads.** It cannot read the page — no CDP, no script injection, no
   `postMessage` — but it decides the URL. A URL is an outbound channel: path and query carry
   whatever the plugin puts in them. A plugin with a webview and any observation of the user has
   a way to phone home that its sandboxed frame does not have.
2. **The user will read the page as part of acorn.** It renders inside a pane, in the app's
   window, with the app's chrome around it. Whatever it shows — a login form, a payment page —
   inherits the app's credibility. This is the UI-spoofing concern from
   `docs/plugins.md`, except the content is not even the plugin's, so
   the plugin cannot be held to have written it.
3. **Third-party cookies and logins are real.** Ephemeral partitions mean the session dies with
   the process and is not shared, but within one session a user may log in to something. That is
   the point of a webview and also the reason CDP stays out permanently.

## What the prompt says

The declared hosts are the grant, and they are what the owner sees. In
`packages/client-core/src/plugins/permissions.ts`, alongside the existing node/UI split:

```ts
// A webview is neither of the two existing groups. The node list is "declared, not enforced";
// the UI list is enforced-and-contained. This is enforced but NOT contained — the host holds the
// allowlist, and the page inside reaches the network like any browser tab would.
export const webviewPermissionLines = (manifest): string[] =>
  webviewSurfaces(manifest).map((surface) =>
    `Show web pages from ${surface.hosts.join(', ')} in the "${surface.label}" pane`)
```

Render it as a **third section** with its own heading — "Shows web pages — enforced hosts, live
network" — rather than folding it into the enforced UI list. The reason is the one
`permissions.ts` already states for keeping node and UI apart: a strong list must not lend
credibility to a differently-shaped claim, and "the sandbox has no network" is the strongest
sentence in the existing prompt. A webview is the one exception to it and must not hide behind it.

The footer sentence under that section, plainly:

> Pages load from the internet with their own cookies and logins. acorn cannot see inside them,
> and this plugin cannot read them or type into them.

Both halves matter: the second is the reassurance the design has actually earned, and it is only
credible if the first is stated first.

## Permission diffs

Host lists are the diff key, like every other permission line. Two rules:

- **Adding a host re-prompts on update**, marked as new. This is the main reason the allowlist is
  in the manifest rather than being a runtime thing the plugin decides.
- **Widening a host to a wildcard is an addition, not an edit.** `docs.example.com` →
  `*.example.com` must mark as new, or the widest possible grant is a silent one. Compare
  normalised entries, and treat a changed wildcard depth as a different entry.

## The UI chrome

The pane's chrome is the host's, never the plugin's, and it always shows the current host. Not
the full URL — a long URL truncates and the host is the part that carries the trust decision —
with the full URL available on hover or in a title attribute.

Two states that need a design, because both are the moment a user is most likely to be misled:

- **Blocked navigation** (phase 1's `webview:blocked`): show it in the host chrome, naming the
  host that was refused. Silently cancelling teaches users the plugin is broken; naming it teaches
  them the allowlist works.
- **Loading a host the user has not seen before within an allowed wildcard**: no prompt — the
  wildcard was the grant — but the host chrome changing is the affordance, which is why it is
  always visible.

## Audit

Install/update/uninstall already audit (`packages/node-core/src/server/routes/plugins.ts`).
Nothing per-navigation: a per-URL audit row is a browsing history of the user's own pane, which is
a bigger privacy cost than the thing it protects against, and it would be written on the node
where the user cannot see it. The grant is auditable at install time; the navigation is the user's
session.

## Docs

- `docs/security.md` § Third-party plugin bundles: a webview paragraph. It currently says a
  plugin's interface has no network; that sentence needs the exception beside it or it is wrong.
- `docs/security.md` summary table: a row for webview hosts — exposure "loads
  remote content the plugin chooses", mitigation "manifest host allowlist enforced across
  redirects; no CDP; ephemeral isolated partition", when "phase 1/2".
- `docs/plugins.md`: the webview surface in the loaded-plugins client section.
- `docs/first-party-plugins.md`: preview's entry gains a note that its *display* half is now a
  shared capability, while its driver and main half remain the reason it is first-party.

## Tests

- `permissionLines.test.ts`: webview lines render as their own group; a plugin with no webview
  surface produces none; hosts are named verbatim.
- Diff: adding a host marks new; `docs.example.com` → `*.example.com` marks new; reordering the
  same hosts marks nothing.
- e2e: the install dialog for a fixture with a webview shows the third section and its footer;
  updating the fixture with a widened host re-prompts with the line marked.

## Exit criteria

- The trust prompt has three honest sections, and the "no network" claim is scoped to the surfaces
  where it is true.
- A host list can only widen through a prompt.
- The pane's chrome always shows the live host, and a blocked navigation is visible rather than
  silent.
