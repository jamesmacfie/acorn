# Settings pages

This page covers how a settings page is built: its rows, how each kind of control saves, details,
and the shape of forms and flows. Read it before you write a settings page. It's part of
[frontend](../frontend.md).

## Pages and the save model

A page is `SettingsSection`s of `SettingRow`s, two kit nodes on `@acorn/plugin-api/ui`
([the closed kit](../ui-design/closed-kit.md#special-nodes)). A row is the label and one line of
description on the left and the control on the right, or under them at full width with
`layout="stacked"`. The description holds only what you need to choose now: a consequence that can't
be undone, a unit, or a format. How it works goes in `help`
([the help mark](../ui-design/tooltips.md#the-help-mark)). The label names the row's one control, so
clicking it flips a switch or focuses a field. Every inline row is at least one control high plus
padding. The row draws its save state on the label's line, so the control column never narrows.

Each kind of row saves in its own way:

- A switch or a select saves when it changes. `createSettingSave()` holds the row's `error`, and the
  control's own state shows the change landed.
- A text field saves on blur or Enter. `createTextSetting({ value, save })` keeps what you type as a
  draft, commits it through `save`, and shows **Saved** for about two seconds (`savedAt`). A failed or
  refused write keeps the draft and puts the message on the row. Committing the stored value writes
  nothing.
- Fields that only make sense together, such as a custom agent, a credential, an MCP server, or a new
  schedule, are a form with **Save** and **Cancel**. The form calls `useUnsavedChanges(dirty)`, and
  every way off the page asks first: Escape, a rail row, **Back to acorn**, the palette, and a deep
  link all go through one `leave()` in `SettingsView.tsx`. No settings page has a **Save** button
  outside a form.
- A row given `onReset`, passed only while the value differs from a known default, marks its label
  with a dot and offers **Reset**.
- A row given `from`, such as `.acorn/config.toml`, says **From …** and disables its control, so the
  value this machine holds stays visible.
- A row stored somewhere other than its page passes `scope="device"` and draws its own **This
  device** chip. **Tool call display** on Harnesses and defaults is the example.
- A row that only seeds new agent sessions says so, and names the control that changes an open
  session, such as `/mcp` on MCP servers.
- A detail page's delete, uninstall, unpair, or revoke sits in `SettingsSection tone="danger"` at the
  bottom and asks through `confirmAction`
  (`packages/client-core/src/host/registries/shell/willPhase.tsx`). The dialog says what goes and what
  stays.

### Details

A page that lists things, such as custom agents or MCP servers, opens one as a detail in the same
pane, never in a dialog. The detail calls `useSettingsDetail(title, back)`
(`packages/client-core/src/features/settings/settingsDetail.ts`). The header shows the item as the
title and makes the page's name in the path a link back to its list, with ⌘[ bound to it. Going back
passes through `leave()`. A detail with its own steps, such as Add connection's gallery and then a
provider's form, passes a third argument, the label of where `back` goes. The hook returns false when
nothing is listening, as on the same page drawn outside Settings, and the page then draws its own back
link.

The helpers are in `features/settings/settingSave.ts`, `features/settings/unsavedChanges.ts`, and
`features/settings/settingsDetail.ts`, on `@acorn/plugin-api/client` for compiled plugins.
`savePref(..., { throwOnFailure: true })` throws instead of posting a background notice, so a row's
error shows once, beside the row. A loaded plugin's tree keeps the same state in its own signals,
because `savedAt` and `error` cross to a sandbox and a function doesn't.

## Forms and flows

A form or flow takes its frame from where it starts. A flow that interrupts, such as first run or an
agent asking to install a plugin, is a `Modal`, and its footer follows the
[dialog rule](../ui-design/overlays.md#dialogs). A flow started from a settings page stays on the page,
such as Add connection or Add a node.

- A form on a page ends in a left-aligned `Inline gap="row"` under its last field: the one `solid`
  primary first, then **Cancel** as `ghost`. A page is wide, and a button at the far edge is hard to
  find from its field.
- A flow of three or more screens says where you are in a muted line above its form, such as "Step 2
  of 3". A two-screen flow needs no count, because its title changes and the back link returns.

Two shapes cover every form on a settings page:

- **The page form.** `Field`s in a `Stack gap="stack"`, label over control, with `md` controls. Any
  error sits between the last field and the buttons. Add connection and Replace key share their
  fields through `features/settings/connections/CredentialFields.tsx`. New MCP server and New custom
  agent take the same shape.
- **The boxed form.** The same fields and buttons inside a `Card`, for a form that opens within a
  section: the Nodes pairing card and the run target form.
