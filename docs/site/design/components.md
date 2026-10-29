# The public site's components

This page covers the components in `apps/site` and the conventions for buttons, labels, and
callouts. [The site's design](../design.md) covers the rest of how the site looks.

The components are in `apps/site/src/components/`. Each has a comment that says what it draws.

| Component | What it is |
| --- | --- |
| `SiteHeader`, `SiteFooter` | The header and the footer on every page. Below 50rem the header's links fold into a menu. |
| `GitHubStars` | **Star on GitHub**, a plain link to the repository. It shows the star count, read at build time, from 100 stars. |
| `Hero` | The stage at the top of a page: headline, paragraph, the oak sprig behind them, and an optional link back to the page's section (`crumb`), actions, and picture. `highlight` sets the end of the headline apart as the hero's verb, in rose over a rule that draws in once. A marketing page puts it in the layout's `hero` slot, and the layout draws one with the page's title when there's none. With `split`, the paragraph and actions sit beside the headline on a wide screen, so the picture starts higher. |
| `InstallBlock` | A tab per install method, its commands after a prompt, and **Copy**. |
| `Specimen`, `SnapshotFrame` | A picture of acorn in a frame drawn like a pane, or a whole window or a phone's screen with rounder corners and a deeper shadow. Neither draws a desktop's window buttons. A specimen has a bar with its name and a caption under it. It switches between its desktop and terminal views with tabs, or shows them side by side with `both`. A snapshot has no bar, and its caption is for screen readers only, so the picture speaks for itself. Either takes a `caption` that replaces its own. |
| `Snapshot`, `Cells` | A [shell snapshot](../snapshots.md) in its frame, and a terminal's cells, which specimens and snapshots share. |
| `Feature`, `Tour`, `Card` | A feature section, the landing page's tour, and a card. A `.features` list already gives the order, so the sections carry no numbers. `Feature` takes `level={3}` under a section's own heading. A `Feature` with no picture keeps to the reading measure. The tour's tabs run down the side on a wide screen, beside the selected tab's words and window. On a marketing page a card is rounder, and its edge takes the accent under the pointer. |
| `DownloadPage`, `BuildFromSource` | The download page, in `apps/site/src/layouts/`, for a release or for none, and its Build from source section. `src/scripts/platform.ts` moves the visitor's platform first. |
| `FeaturePage` | The layout of a feature page, in `apps/site/src/layouts/`: the title and sentence from `apps/site/src/features.ts`, a picture, the page's sections, **In the terminal**, related features, and **Get started**. A new feature page needs an entry in `features.ts`, which the features index reads too. |
| `Badge`, `Keys` | The kit's own `Badge` and `Kbd` markup, with the text kept in `--text`. |
| `ReferenceTable`, `Checkpoint` | A table with a sticky header and an anchor per row, and a step's check. |
| `SocialCard` | The 1200 by 630 picture a shared link shows ([social cards](../agent-outputs.md#social-cards)). |
| `Search` | The header's search, drawn with the command palette's markup ([search](../agent-outputs.md#search)). |

A primary button is the accent, with `--bg` as its ink, and `data-size="lg"` makes it a page's main
action. A page has one. `.segmented` turns a tab strip into buttons in a tray, the selected one
inverse, as the hero's desktop and terminal switch does. A heading is one color. The hero's verb is the
only words set apart, and only on the landing page.

A label, such as a footer column's name or a changelog entry's date, is mono, a step smaller, in
sentence case and untracked. The app's own labels are uppercase and tracked in the Terminal pack, which
suits a dense pane, so the docs' sidebar and tables keep them.

Callouts are Starlight's asides, restyled in `site.css` as the kit's banner `Alert`. A marketing page
writes `class="callout"` for the same look. Steps are
Starlight's `<Steps>`. Tabs and copy buttons share two small scripts in `apps/site/src/scripts/`.
