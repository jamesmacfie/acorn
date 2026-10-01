# 06-11. The Add connection gallery: titles at three heights, and faint text

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The provider cards are buttons, and a button centres its content vertically. A card whose title wraps,
or that has a third line ("Listed on AI models"), starts its text higher, so the three titles in the
first row sit at three heights. The line that tells people what they will need ("Personal API key")
is `--text-faint`, the colour for hints. The logo box is a literal 30 by 30.

## Where to see it

Settings › Services › **Add connection**, and Settings › AI models › **Add a key**.

## Already done

- K3 routes a `Button`'s `title` to the styled tip, so each card's hover text no longer uses the
  browser's tooltip. Changing `title` to `tip` at `AddConnection.tsx:101` is still the tidy form.

## The fix

In `packages/client-core/src/infra/styles/integrations.css`, around `:84-108`:

- Cards take `justify-content: flex-start`. The card's inner span takes `align-self: stretch;
  align-items: flex-start`. Every title then starts 14 from the top.
- `.connection-card-sub` reads `--text-muted`.
- The logo box is `--control-h` square, with the mark at `--icon-box`.

In `packages/client-core/src/features/settings/connections/AddConnection.tsx` around `:101`: `title`
becomes `tip`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `AddConnection.tsx:91` | Listed on AI models | Keep | |

The Sentry card's own name is [06-18](./06-18-smaller-defects.md) item i.

## Risk and checks

- Before you start, confirm the card markup still has the inner span the selectors name.
- CSS hygiene: no literal radius, border width, or font-size. The two size changes use tokens.
- Screens: the gallery from Services and from AI models, in Terminal and in one other pack.
- Tests: client-core (the CSS hygiene test).
