# The public site's motion

This page covers what moves on the public site, when, and how reduced motion stops it.
[The site's design](../design.md) covers the rest of how the site looks.

Nothing moves under reduced motion: `site.css` sets the duration tokens to zero there, every
animation sits inside `@media (prefers-reduced-motion: no-preference)`, and the landing page's script
adds its `live` and `film` classes only when the visitor allows motion.

A marketing page's hero comes in as the page loads, each part rising a little after the one before.
Further down, a feature page's sections and the cards rise the same way as they scroll into view. They
finish before they're a third of the way in, so nothing is still faint where you'd read it, and a
browser without scroll timelines shows them in place. A primary button lifts and grows a little on
hover, a link's underline turns from a rule to the accent, and an FAQ answer slides open where the
browser can animate to `height: auto` (`interpolate-size`).

The Playwright accessibility tests run with reduced motion, so axe reads each block where it settles
rather than partway through rising in.

## The landing page

The landing page is a film the visitor scrolls through. `apps/site/src/styles/landing.css` holds every
moving rule under `.live` or `.film` ([the landing page's look](./landing.md)),
and `apps/site/src/scripts/landing/film.ts` adds those classes and runs what CSS can't: the headline,
the lanes, the pairing output, and building the window taken apart.

Each moving part plays one set of `@keyframes` laid over its scene's whole scroll, 0% to 100%. A
pinned scene's 0% to 100% is the stretch it's pinned for, and any other scene's is its trip from the
window's foot to its top. Where the browser has scroll timelines, each scene is a view timeline called
`--scene`, and the compositor plays the moves along it. Elsewhere, such as Firefox without its flag,
`film.ts` sets `--p` on each scene, from 0 to 1, once a frame while the page scrolls, and each move is
paused at that point with a negative `animation-delay`. The two ways share the keyframes, so a move is
written once.

These move under `live`, on any screen:

| What | How it moves |
| --- | --- |
| The headline's last two words | Each letter takes its own width from Anybody's width axis. The widths swell around one point, which follows the pointer and wanders when the pointer has rested for two and a half seconds. They always average the same, so the words keep their length. |
| The running type | The scroll pushes one band left and the other right. |
| The lanes | Each lane's agent types what it's doing, a line at a time, rests on what it's waiting for, and starts over. The page ships each lane at rest. |
| Blocks with `data-reveal` | Each rises in the first time it's reached: the lanes, the steps, and the plugin tiles, one after another. |
| The pairing output | It types itself out once, when it's reached. Its box keeps its full height while it fills. |
| The closing band | The last line starts squeezed and stretches to the band's width, and the acorn pops its cap. |

These need `film`, a window at least 60rem wide and 36rem tall:

| Scene | What the scroll does |
| --- | --- |
| The opening | The stage pins. The words leave, the task's window tips up from lying back to face the visitor, then turns over to show the same task in the terminal client on its back. A note under it names each side. |
| The deck | The stage pins with the five pane groups' names down the left and their windows stacked on the right. The front window flies off past the visitor, the next comes up, and its name and paragraph take over. |
| The window, taken apart | The stage pins. The window lies down at an angle, and each part a plugin draws lifts off it under its plugin's name. |
| Away from the desk | The browser's panel and the two phone screens turn and drift at their own speeds as the row scrolls by. |
| Nodes | Fleet home's window turns to face the visitor. |
| The rail | The chapters as strokes down the window's right edge, the one in view marked. Their names show under the pointer or the keyboard. |

The parts that lift off the window are copies. `film.ts` measures each part in the picture by what the
capture calls it, such as the Git pane's `Git list` region, and gives it a copy of the whole window
cut down to its box. If a capture renames a pane, that part doesn't lift, rather than lifting the
wrong one. The copies are made the first time the scene comes within a screen of the window, and they
hold no ids.

### Keeping the film at 60 frames a second

Chrome sorts the whole page's painted content into layers again (the `Layerize` step in a trace) after
most changes to what's painted. With six windows of about 1,500 elements each near the screen, one
pass costs 6 to 12 milliseconds on an Apple silicon Mac, and 25 to 50 at four times slower. These
rules keep that pass out of a scroll. Each fixed a measured stall, so keep them when you add a scene.

- Move only `transform` and `opacity`, and only through keyframes on a scroll timeline. The
  compositor runs those, and the page's own thread does nothing for them. A move the page's thread
  makes, even one transform from `calc()`, cost a full pass every frame: 23 to 47 milliseconds a frame
  at four times slower in every scene. Write a scale or a slide as `transform`. The separate `scale`
  property on the deck's mark wasn't handed to the compositor cleanly.
- A move the compositor can't run, such as `pointer-events` on the deck's paragraphs, goes in its own
  keyframes with `step-end`, so it changes once rather than on every frame, and doesn't hold back the
  moves beside it.
- A view timeline's inset is 0. It otherwise follows the page's `scroll-padding`, which leaves 88
  pixels for the header, and every move ran ahead of `--p`.
- A desktop window that's off the screen isn't painted (`content-visibility: auto`), and the window
  taken apart hides its picture while it's more than a screen away (`data-far`). Its six windows
  otherwise made every later pass cost 25 milliseconds at four times slower, wherever the visitor
  was. `content-visibility` on that whole scene skipped it too, but when the scene came back Chrome
  ran its moves on the page's own thread for the first 30 frames.
- Each lifted part's copy of the window hides everything but the part, so six windows cost about as
  much to paint as two.
- Text that types itself changes only when nothing near it moves. The lanes write each line whole and
  slide a cover off it a letter at a time, on the compositor. Writing a letter at a time cost a full
  pass on every other frame while the board was on the screen. The headline's letters stop once the
  film has faded them, because changing them under the header's blur cost a pass each frame.
- `--p` is registered with `@property` and doesn't inherit. Each element between a scene and a moving
  part asks for it with `--p: inherit`, in the list under **Moves** in `landing.css`. An inherited
  `--p` restyled every element in the pictures every frame.
- The lanes type only while the board is on the screen.

`film.ts` measures the parts against the app's own root in the picture, and before the window goes
into the wrapper that tilts it. An unpainted window reports its boxes at the app's full size, and a
tilted one reports the boxes of its tilted parts.

#### Measuring

Measure the production build, not `astro dev`: run `astro build`, then
`astro preview --ignore-lock --host 127.0.0.1 --port <port>`. Open the page at 1440 by 900 in Chrome,
slow its processor with `Emulation.setCPUThrottlingRate` through a DevTools Protocol session, and
scroll each scene 30 pixels a frame from a `requestAnimationFrame` loop with a trace running. Read
the time between frames and the time under `Layerize`. Test jumping straight into the middle of the
window taken apart as well as scrolling in, and test a scene you come back to, not only the first
visit.

On November 14, 2026, on an Apple silicon Mac, the mean time between frames in milliseconds, with the
share of frames over 20 milliseconds:

| Scene | 1x before | 1x after | 4x before | 4x after | 6x before | 6x after |
| --- | --- | --- | --- | --- | --- | --- |
| The opening | 16.7 | 16.7 | 32.2 (81%) | 17.5 (4%) | 42.2 (81%) | 17.8 (6%) |
| Running type | 16.7 | 16.7 | 54.2 (98%) | 19.2 (10%) | 84.2 (100%) | 20.8 (8%) |
| The lanes | 16.7 | 16.7 | 23.6 (40%) | 18.4 (8%) | 23.3 (23%) | 21.5 (19%) |
| The deck | 16.8 | 16.9 | 31.0 (77%) | 19.3 (11%) | 59.5 (94%) | 27.0 (19%) |
| The window taken apart | 16.7 | 16.7 | 51.8 (82%) | 19.4 (8%) | 86.8 (96%) | 21.3 (7%) |
| Away from the desk | 16.7 | 16.7 | 37.7 (84%) | 18.1 (5%) | 58.8 (100%) | 20.8 (6%) |
| The closing band | 16.7 | 16.7 | 26.8 (61%) | 16.7 (0%) | 40.6 (88%) | 16.7 (0%) |

At 1x, Chrome already met every frame before the change, but `Layerize` took 4.5 to 11 milliseconds of
each one. It takes 0.1 to 1.7 after. The frames still over 20 milliseconds at 4x are single passes
when something changes once: a window coming into view, a deck paragraph taking the pointer, a lane
starting a line. Only Chrome was measured. Safari 26 and Firefox weren't installed.

To check a scene, open the page in `pnpm dev:site` and scroll through it, then again with reduced
motion and at a phone's width. A full-page screenshot is taken from the top, so it shows every scene
at its start. Scroll to a position and take a screenshot of the window instead.
