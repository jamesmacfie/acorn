# The public site's motion

This page covers what moves on the public site, when, and how reduced motion stops it.
[The site's design](../design.md) covers the rest of how the site looks.

Nothing moves under reduced motion: `site.css` sets the duration tokens to zero there, and every
animation sits inside `@media (prefers-reduced-motion: no-preference)`.

A marketing page's hero comes in as the page loads, each part rising a little after the one before.
Further down, the landing page's chapter heads, steps, tour, windows, and grids, a feature page's
sections, and the cards rise the same way as they scroll into view. They finish before they're a third
of the way in, so nothing is still faint where you'd read it, and a browser without scroll timelines
shows them in place. A primary button lifts on hover, a link's underline turns from a rule to the
accent, and an FAQ answer slides open where the browser can animate to `height: auto`
(`interpolate-size`).

Three moments are the site's own. The rule under the hero's verb draws in once, after the headline
lands. The oak sprig over a stage comes in from where its twig enters, over a second and a half, and
sways where a pointer brushes it, settling in about two seconds. The closing acorn on the landing page
tips its cap when the pointer or the keyboard reaches **Get acorn**.

The Playwright accessibility tests run with reduced motion, so axe reads each block where it settles
rather than partway through rising in.

The landing page has two scroll-linked animations, CSS scroll-driven animations with no script. The
track over the three steps of a task fills left to right as they scroll up the screen, and the
plugins chapter's window outlines what plugins draw as it comes into view. Each sits inside
`@media (prefers-reduced-motion: no-preference)` and `@supports (animation-timeline: view())`, and
the static styles are the finished state, so a browser without scroll timelines shows the full track
and every outline.

The outlined window is the hero's snapshot again. Its selectors name each part by what the capture
calls it, such as the Git pane's `Git list` region, so a new capture keeps the outlines in place. If a
capture renames a pane, its outline and name disappear rather than land on the wrong part.
