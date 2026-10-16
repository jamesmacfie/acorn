# Phase 13: a Context picker in the composer (optional)

Date: October 16, 2026. Status: skipped. On October 16, 2026, the plan's owner chose to
leave the Context picker out. The right-click entry stays the way to capture a page, and the **Context** slot
in phase 7's bar stays empty.

## The decision

Commit `f0d3bb7e9`, on October 14, 2026, removed the composer's three capture icon buttons. Since
then, a person captures a page from the page's right-click menu, **Add to Acorn chat**. The prototype
brings capture back to the composer as one **Context** control in the desktop composer's shape.

Decide before you start:

- **Build it** if people miss capturing from the panel, or if the panel should match the desktop's
  composer.
- **Skip it** if the right-click entry is enough. Then leave the **Context** slot in phase 7's bar
  empty, and close this phase.

The plan's owner makes this call. Record the answer and its date in the status line above.

## Goal

One **Context** button in the composer's bar adds the page link, the selected text, a screenshot, or
an element you point at, as chips above the message box.

## In the prototype

- Scenario: **Add page context**. Choose **Pick an element**, then click something on the page.
- Notes: `context` at line 1312, with the decision box.
- Code: the `context` case of `pickerSpec` at line 1080 lists the rows. `composer` at line 980 draws
  the **Context** button and the chips. `chipView` at line 978 draws a chip, with an × when it can be
  removed.

## Starting point

- `apps/extension/src/capture.ts` captures a page's link, its selected text, and a screenshot of the
  visible part. [Page capture](../../browser-extension/page-capture.md) covers page access and the
  attachment operations that send them.
- `apps/extension/src/content/picker.ts` picks an element, for the ask box.
- The composer in `apps/extension/src/sidebar/Composer.tsx` already draws captures in the draft as
  chips, and keeps them in browser storage with the draft.
- [Context references](../context-references.md) plans the desktop composer's **Context** list,
  with sources registered by plugins. The extension is out of its scope.

## The design

**Context** is a small button with a plus and a chevron at the left of the composer's bar. It opens
the kit's `Picker` with "Filter context sources" and one group, **This page**:

- **Page link**, `link`, with the page's title as its note.
- **Selected text**, `text-cursor`, with the first words of the selection in quotes. Greyed with "No
  text selected" when there's none.
- **Screenshot**, `camera`, "The visible part of the page".
- **Pick an element**, `crosshair`, "Point at something on the page". It closes the picker, starts the
  picker on the page, and adds the element and its screenshot as two chips when the person clicks.

Each choice runs the capture `capture.ts` already has and adds its chip to the draft, as the
right-click entry does. A capture that needs page access the extension lacks says so in the picker's
row, greyed, rather than failing after the click.

The prototype also lists an **Acorn** group, with **Task context** and **Memory**. Leave it out. No
bridge operation reads either, and the desktop's [context references](../context-references.md) plan
defines how those sources work. Add the group once that plan ships, from the same registry.

## Changes

1. Add the **Context** button and its picker to the composer's bar.
2. Call the captures `capture.ts` has from it, and the element picker for **Pick an element**.
3. Grey a row the page can't give, with the reason.
4. Test each row, including a page without access and an empty selection.
5. Update [page capture](../../browser-extension/page-capture.md).

## Acceptance

- **Context** › **Page link** adds a chip with the page's title, and sending sends the link.
- With text selected on the page, **Selected text** shows its first words and adds them.
- **Pick an element**, then a click on the page, adds two chips: the element and its screenshot.
- On a page the extension can't read, **Screenshot** is greyed and says why.
