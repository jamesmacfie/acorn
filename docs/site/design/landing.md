# The landing page's look

This page covers how the landing page is built as a scroll film: its files, its scenes, and how to add
one. [The site's design](../design.md) covers the rest of how the site looks.

The landing page is a film the visitor scrolls through, with acorn's own windows as its cast. Its
markup is `apps/site/src/pages/index.astro`, its look is `apps/site/src/styles/landing.css`, and its
motion is `apps/site/src/scripts/landing/film.ts`. [Motion](./motion.md) lists what moves.

- The page passes `bleed` to `Marketing.astro`, so its sections run to the window's edges. Each keeps
  its own width with `.wrap`, up to `--land-width`, and the header lines up with that.
- The page is a plain column first. Every rule outside a `.live` or `.film` block is the finished,
  still page: every window flat, and every list in order. That's what a visitor without script, with
  reduced motion, or on a small screen gets.
- `film.ts` adds `live` to `<html>` when the visitor allows motion, and `film` when the window is
  also at least 60rem wide and 36rem tall. Three scenes pin under `film`: the opening, the deck of
  panes, and the window taken apart.
- A scene is an element with `data-scene`. Each moving part in it plays one set of `@keyframes` laid
  over the scene's whole scroll, 0% to 100%. Where the browser has scroll timelines, the scene is a
  view timeline called `--scene`, and the compositor plays the moves. Elsewhere `film.ts` sets `--p`
  on the scene, how far the scroll has taken it from 0 to 1, and each move is held paused at that
  point. A pinned scene (`data-scene="pin"`) is taller than the window and holds a sticky stage.
- The page reads dark, blaze, page, dark, page, blaze, dark: the opening and the plugins scene are on
  the night stage, and the running type and the closing band are on the blaze.

A new scene needs no script of its own: give it `data-scene`, write its moves as keyframes, and add
each moving part to the lists under **Moves** in `landing.css`. Keep its still state outside `.live`
and `.film`, and check it with reduced motion.
