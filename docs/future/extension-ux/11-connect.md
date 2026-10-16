# Phase 11: install the bridge, pair, and finish

Date: October 16, 2026. Status: proposed. Depends on [phase 10](./10-settings.md) for the Node
rename, because this phase drops the name field from pairing.

## Goal

Getting connected shows one job per screen. A missing bridge shows the command to run and a spinner.
Pairing makes the Mac's own Node the obvious choice. **Connect** asks Acorn to approve the browser, so
the common path is one click here and one in Acorn. Pairing with another Node still compares identity
words, in fewer controls. The paired screen offers the sites worth allowing and notifications, then
**Done**.

## In the prototype

- Scenarios: **Bridge not installed**, **Pair with this Mac**, **Pair with another Node**, and
  **Paired**. The notes for the first two have buttons that simulate the bridge answering and Acorn
  approving.
- Notes: `bridge` at line 1279, `pair` at line 1283, `pair-remote` at line 1286, and `pair-done` at
  line 1287.
- Code: `bridgeView` at line 804, and `pairView` at line 811, which draws every pairing step: `find`,
  `approve`, `address`, `identity`, `code`, and the paired screen. `topBar` at line 742 draws the bare
  bar these screens use.
- Today: `references/extension-ux/today/01-bridge-missing-dark.png`,
  `02-pair-choose-dark.png`, and `03-pair-code-dark.png`.

## Starting point

- `App.tsx` shows a missing or refused bridge as a red error banner, the command, and "The panel
  checks again every few seconds and carries on once the bridge answers." It asks again every 3
  seconds. `apps/extension/src/sidebar/guidance.ts` holds the command and the wording for each state.
- `apps/extension/src/sidebar/Pairing.tsx` has the steps: choose a Node, check a typed address's
  identity words, and the code step. The code step shows the approval phrase, a code field, a hint,
  and a name field at once. It calls `node.ask`, then `node.collect` once a second until the owner
  allows the browser in the desktop, and `node.pair` with a typed code. The name defaults to "This
  computer" for the local Node.
- The identity step has a **The words match** checkbox and **Continue**.
- After pairing, a **Paired** section shows site access and notifications under more headings, with a
  "Switch Nodes from the chip at the top" line.

[Pair a Node](../../browser-extension/setup.md#pair-a-node) and
[pairing and custody](../../browser-extension.md#pairing-and-custody) document today's flow.

## The design

These screens have a bare top bar: the acorn mark and "Acorn", and a close button on the middle
pairing steps that returns to the first. No Node chip, no **Needs you**, no Settings, and no strip.
Nothing else works without a bridge and a Node, so nothing else shows.

### Bridge not installed

A centred empty state:

1. The acorn drawn in text, as `ACORN_ART` in the prototype, styled like the desktop's empty acorn.
   The kit's `packages/client-core/src/kit/components/content/Acorn.tsx` may already draw it. Check
   before you add one.
2. "Install the browser bridge" as the heading.
3. "Run this in a terminal. The extension reaches Acorn through it."
4. The command in a block that's a single button: a `$`, `acorn browser install`, and a copy icon
   that turns into a check after copying.
5. A spinner and "Waiting for the bridge".

A bridge that refuses this extension gets the same screen titled "Repair the browser bridge", with the
same command. Keep the 3-second check. Remove **Retry**, if the screen has one, and the sentence about
checking.

### Pair with this Mac

1. The acorn, then "Connect to Acorn".
2. A card for the local Node: a laptop icon, **This computer** with its address in monospace under it,
   and **Connect**, solid.
3. **Connect to another Node** as a bare link under the card.

When no Node runs on this computer, leave the card out and show the link as a plain button.

**Connect** calls `node.ask` and shows **Approve in Acorn**: "Acorn on this Mac asks to allow this
browser. Allow it if it shows these words.", the phrase as word chips, and a spinner with "Waiting
for approval". Keep calling `node.collect` once a second. Under it, **Use a pairing code instead** as
a bare link, which reveals a **Pairing code** field with **Pair** and the hint "In Acorn: Settings ›
Nodes › Pair a browser".

A Node that can't take an ask goes straight to the code field.

### Pair with another Node

1. **Connect to another Node**: an **Address** field, starting with `https://`, and **Check**, which
   calls `node.probe`.
2. **Check its identity**: "studio.lan shows these words in Settings › Nodes. Continue only if they
   match.", the six words as chips, and **They match**, solid, beside **Cancel**. **They match**
   replaces the checkbox and **Continue**.
3. **Enter the pairing code**: the field, **Pair**, and the hint naming the other Node.

### The name

Remove the name field. The local Node is named "This computer". A typed address is named by its host,
as `Pairing.tsx` already defaults it. Phase 10 renames a Node in Settings.

### Paired

A green `circle-check` and "Connected to *name*". Then **Allow on these sites**, one row per site the
Node's handoffs name, each with its logo, its use, and a switch for browser access. Then
**Notifications** with the switch phase 10 describes. Then **Done**, solid, which goes Home.

Remove the "Switch Nodes from the chip at the top" line.

Delete "Found in this Mac's Acorn data folder." and the extra headings: "Home", "Pair this browser",
and "PAIR THIS BROWSER" become the one heading each screen has.

## Changes

1. Redraw the bridge-missing and bridge-refused states in `App.tsx` as the empty state above, and
   update their wording in `guidance.ts`.
2. Redraw `Pairing.tsx` as the steps above, with the code behind **Use a pairing code instead**.
3. Merge the identity checkbox and **Continue** into **They match**.
4. Remove the name field, and pass the default name to `node.collect` and `node.pair`.
5. Redraw the paired screen, and end it with **Done**.
6. Update the pairing tests in `App.test.tsx` and wherever `Pairing.tsx` is tested. Add a test that
   **Connect** asks and collects, and that **Use a pairing code instead** pairs with a code.
7. Check `pnpm dev:extension:ui pairing-code` and the other verbs still reach the fields they name.
8. Update [set up and troubleshoot](../../browser-extension/setup.md) and the pairing section of
   [the browser extension reference](../../browser-extension.md#pairing-and-custody).

## Acceptance

- With no bridge installed, the panel shows the command and a spinner, and moves to pairing within 3
  seconds of `acorn browser install` finishing.
- With the desktop running, **Connect** shows the phrase, the desktop's dialog shows the same words,
  and allowing it there lands on the paired screen.
- A typed address shows six words, and **They match** goes to the code step.
- A paired Node is named "This computer", and Settings can rename it.
- **Done** goes Home.

## Risks

The approval path needs someone at the desktop app. The terminal client shows no approval prompt, so
a person who runs only the terminal client must use the code. Keep **Use a pairing code instead** one
click away for that reason.
