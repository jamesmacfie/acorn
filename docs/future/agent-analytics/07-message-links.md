# Phase 7: link to one message in a session

Date: October 19, 2026. Status: proposed. Needs nothing. Phase 8 uses it when it exists, and works
without it.

## Goal

An `acorn://` link can open a session at one message, and the transcript draws that message in view
and marks it for a moment. **Copy link to message** sits in a message's menu. A plugin's mark detail
can then say "5 failed commands in a row" and link to the first of them, and so can a note, an issue
comment, or a memory.

## Starting point

- The link forms are parsed and built in `packages/client-core/src/host/registries/commands/addresses.ts`.
  `acorn://<node>/t/<taskId>?pane=<paneId>&item=<itemId>` opens a task pane at an item, and an item
  needs a pane ([Acorn links](../../frontend/acorn-links.md)). The terminal opens links in
  `apps/tui/src/chrome/link.ts`.
- The transcript draws a fixed window of the newest 200 cards. A remembered reading place, or a named
  request in a hidden card, already reveals its page before drawing it
  ([the window](../../managed-agents/transcript.md#the-window)). The transcript store holds every
  event of a session it draws, so the card holding any sequence is in memory once the session loads.
- The retention pass can remove a session's events and leave its row
  ([archived agent history](../../managed-agents/history-retention.md)).
- A message's menu is the `agent.message` place, which any plugin's menu rows can join
  ([places to fill](../../contribution-kinds.md#places-to-fill)).
- `richTooltipDom` in `packages/client-core/src/features/editor/richTooltip.ts` renders a mark's detail
  through the shared sanitizer. Check whether it keeps `acorn:` links. Phase 6's acceptance expects it
  to drop `javascript:` ones.

## The design

### The address

Add an optional `at` to the task form: `acorn://<node>/t/<taskId>?pane=<paneId>&item=<itemId>&at=<position>`.
`at` needs an item, as an item needs a pane. It's an opaque string of at most 64 characters, and the
pane that owns the item says what it means. For the Agent pane, the item is a session id and `at` is an
event sequence number. `parseLink` and `buildLink` treat it like `item`: decoded once and checked for
length. A pane that doesn't read `at` ignores it, so the link still opens the session.

### The reveal

The Agent pane receives `at` with the item. After the session loads, it finds the card whose events
include that sequence, through the same reveal the window uses for a remembered place. It draws that
card's page, scrolls it into view, and gives it a highlight that fades after two seconds. Focus moves
to the card, so a screen reader announces it.

If the sequence is past the session's last event, or the retention pass removed it, the pane opens the
session at its newest page with a notice: "That message's history was removed." The notice names
nothing from the link.

The terminal client does the same, and moves its cursor to the card.

### Copy link to message

Agents adds **Copy link to message** to the `agent.message` menu. It copies the link with the message's
first sequence, through the same clipboard path as **Copy link**.

### Links in mark detail

If the sanitizer drops `acorn:` links, allow that one scheme in mark detail. An `acorn:` link only
navigates or asks for confirmation, and carries no authority
([input and authority](../../frontend/acorn-links.md#input-and-authority)). Pressing one goes through
the same opener as any other `acorn:` link.

A Node plugin can't name its own Node: no part of its context returns the Node id, and `local` means
the device's home Node, which is wrong for a remote one. So in a mark's detail, the Node segment `this`
means the Node that answered the mark. The annotation host knows which Node it asked, and rewrites
`acorn://this/` to that Node's concrete id when it accepts the mark, before anything draws it. The
rewrite applies to mark detail only. Everywhere else, `this` is not a Node id and the parser refuses it.

## Steps

1. Add `at` to the parser and builder, with tests for decoding, length, and "at needs an item".
2. Pass `at` to the pane with the item, on both clients.
3. Reveal and highlight in the Agent pane, with the removed-history notice.
4. Add **Copy link to message**.
5. Check `acorn:` links in mark detail, allow them if they're dropped, and rewrite `acorn://this/` in
   the annotation host, with tests for a home Node and a remote one.
6. Update [Acorn links](../../frontend/acorn-links.md) and [the transcript](../../managed-agents/transcript.md).

## Acceptance

- In `pnpm dev:agent`, **Copy link to message** on a message 1,000 cards back, then opening the link
  from another task, shows that message with its highlight.
- `pnpm dev:agent:ui -- --session <name> link <address>` opens the same place.
- A link to a session whose history was removed opens the session with the notice.
- The terminal client opens the same link with `acorn --link` and moves its cursor to the card.
