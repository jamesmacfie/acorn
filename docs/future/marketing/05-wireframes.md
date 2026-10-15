# Phase 5: wireframe every template

Date: October 15, 2026. Status: proposed. Needs phases 1 and 2. Phase 6 depends on it.

## Goal

Every page template exists as a grey-box layout with real words in it, built before anyone picks a
color or a typeface. Structure gets settled here, where it's cheap, and not in phase 6, where it isn't.

The run doesn't stop for a review. See [how agents run these phases](./README.md#how-agents-run-these-phases).
James reviews the wireframes on the local site at the end of the run.

## Starting point

- Phase 1 chose the headline, the feature ranking, and the landing outline.
- Phase 2 created every route and the `/lab/` folder, which never reaches production.
- If phase 3 has landed, real specimens can sit in the wireframes. If it hasn't, use grey boxes at the
  specimen's real size.
- [Research](./research.md) records the layouts worth copying: herdr's full-width product picture under
  the headline, hunk's install tabs, orca's tabbed feature tour, gh-dash's config beside its result.

## Why wireframes live in the site

Build the wireframes as Astro pages under `/lab/wireframes/`, not in a design tool. The final medium is
HTML at real widths, the reviewer opens a page on the local site, and the wireframe's components become
the page's components in phase 6. A design tool would also add an account and a sync step for
something the site can do directly.

Use one wireframe stylesheet: grey boxes, one sans-serif font at one size, black text, and labels that
say what each box will be. No color, no icons, no imagery. A reviewer who comments on the shade of grey
is reviewing the wrong thing.

## Templates

Wireframe each at 1440 pixels wide and at 375 pixels wide:

1. **Landing.** Every section from [phase 8](./08-landing.md#the-page-from-top-to-bottom), in order,
   with the real headline, the real paragraph, and draft copy everywhere else.
2. **Features index** and **feature page.** One feature page wireframe with real copy for
   `/features/agents/`, since it has the most to show.
3. **Download.** Both states: no release, and a release with assets for every platform.
4. **Changelog.** The list, one entry, and an entry with a plugin author callout.
5. **Plugins directory.** Cards for every bundled plugin.
6. **Docs home.** Two doors, **Use acorn** and **Build plugins**, plus the Start here path.
7. **Docs guide page.** Prose, a numbered procedure, a code block with a file path label, a specimen, a
   callout, and previous and next links.
8. **Docs reference page.** A generated field table with a filter box, and anchors on every row.
9. **Component page.** A specimen with its two tabs, the props table, the host support table, and an
   example.
10. **Built-in plugin page.** The facts box from [phase 13](./13-docs-built-in-plugins.md#the-page-shape),
    setup steps, and a settings table.
11. **Tutorial page.** Numbered steps with a checkpoint after each.
12. **Search.** The search palette open over a docs page, with grouped results.
13. **Header, footer, and mobile navigation.**
14. **404.**

## Decisions

James accepted these on October 15, 2026. Build to them. If building one shows it doesn't work, change
it, and write the change and its reason here.

- **Landing hero.** Headline and paragraph across the full width, install action under them, and the
  desktop and terminal picture full width below. The picture is the proof, so it gets the room.
- **Docs layout.** Sidebar, content, and table of contents above 1280 pixels. A specimen may break out
  of the text column to the full content width. Below 1024 pixels, the table of contents folds into a
  menu at the top of the page.
- **Reference filter.** A filter box on long generated pages, such as the manifest reference. It costs
  about 2 KB of script and saves scrolling through hundreds of rows.
- **Where "Build plugins" sits.** Its own top-level navigation item, beside **Docs**, because it's half
  the docs and has a different reader.
- **Version label.** The plugin API major shows in the plugin docs header, read from source.

## Self-review

Check every template on the local site at 1440 and 375 pixels wide. For each template, check that:

1. Someone new can say what the page is for from the top 600 pixels.
2. From the docs home, a plugin author reaches "Add a pane" in two clicks, and a user reaches "Agent
   sessions" in two clicks.
3. The mobile layout keeps the same order and loses nothing.

## Out of scope

Color, type, brand, motion, and final copy below the hero. Those are phases 6 and 8.

## Acceptance

- All 14 templates are under `/lab/wireframes/` on the local site at both widths.
- Any change to the decisions above is recorded in this file with its reason.
- The two-click checks pass for the paths in the self-review list.
