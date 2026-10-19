# The landing page's Lighthouse scores

This page covers the landing page's Lighthouse target, how to check it, and the scores it has had.
[The site's design](../design.md) covers how the page looks, and [fonts](./fonts.md) covers the faces
that cost the most on a slow connection.

The landing page has to score at least 98 for performance on mobile and 100 for accessibility. Check it
by hand against a production build served by `astro preview`, with Lighthouse's default mobile settings:

```sh
pnpm --filter @acorn/site build
pnpm --filter @acorn/site exec astro preview --ignore-lock --host 127.0.0.1 --port 4339
npx lighthouse http://127.0.0.1:4339/ --form-factor=mobile --only-categories=performance,accessibility
```

| Date | Page | Performance | Accessibility | First paint | Largest paint |
| --- | --- | --- | --- | --- | --- |
| October 16, 2026 | The landing page as phase 8 built it | 99 | 100 | 1.7 s | 1.8 s |
| October 19, 2026 | The landing page on the dark stage | 98 | 98 | 1.7 s | 2.3 s |

The October 19 accessibility score loses its two points on `heading-order`. The plugins chapter puts the
Hello pane's specimen, whose own heading is an `<h2>`, between the `<h4>` headings Start from the
scaffold and Or ask your agent. The hero's headline only rises as the page loads, never fades in,
because a heading at zero opacity isn't counted as drawn: fading it moved Lighthouse's largest paint to
the header's mark.

Lighthouse 13.5 simulates a slow phone connection, and on it the fonts cost the most. With the full
JetBrains Mono files the landing page scored 90, and a page with almost no content scored 95. The site
serves subsets of the fonts, and marketing pages preload the regular and bold faces and
Inter ([fonts](./fonts.md)). `astro preview` serves gzip, so the landing page's HTML arrives as
73 KB there, against 27 KB with Brotli.
