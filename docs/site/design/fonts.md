# The public site's fonts

This page covers the faces `apps/site` draws in, where each comes from, how the JetBrains Mono subsets
are built, and what the marketing pages preload. [The site's design](../design.md) covers the rest of
how the site looks.

| Face | Where it comes from | Used by |
| --- | --- | --- |
| JetBrains Mono 2.304 | `apps/site/public/fonts/`, regular, bold, and italic, with its license in `OFL.txt` | Every pack's `--font-mono`, and the Terminal pack's `--font-ui`: every heading, label, button, and line of code, and all of a docs page |
| Inter | The app's own file, through `@acorn/client-core/infra/styles/fonts.css` | A marketing page's paragraphs, as `--site-font-body` |

`site.css` puts JetBrains Mono first in `--font-mono`, ahead of the app's fallback stack. A marketing
page reads in Inter beside mono headings, the way the app's Modern pack pairs them. Until Inter loads,
the page draws in Arial stretched to Inter's measurements (`Inter fallback` in `site.css`), so its lines
don't move when the face arrives. `fonts.css` also declares Literata and Nunito, for style packs the
site never sets, and a browser fetches a face only when a rule uses it.

The JetBrains Mono files are subsets, about 20 KB each against 90 KB for the release's files, because
a phone on a slow connection waits for them before it draws the page's text. Each keeps Latin-1, the
punctuation and symbols the site writes, arrows, the Mac key symbols, and the box-drawing, block, and
shape ranges the terminal view of a specimen draws. They leave out the programming ligatures, which
the app doesn't draw either. A character outside the subset falls back to the next face in
`--font-mono`. `Marketing.astro` preloads the regular and bold faces and Inter, the three the first
screen uses. Inter's preload reads the file's built URL through the export client-core gives it.

To rebuild them, take the `.woff2` files from the JetBrains Mono 2.304 release and run this for each of
`Regular`, `Bold`, and `Italic`:

```sh
uvx --from fonttools --with brotli pyftsubset JetBrainsMono-Regular.woff2 \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2010-2027,U+2030-203A,U+2044,U+20AC,U+2122,U+2190-2199,U+21A9,U+21B5,U+21D0-21D3,U+21E7,U+2212,U+2303-2304,U+2318,U+2325,U+232B,U+238B,U+23CE,U+2500-25FF,U+2713,U+2715,U+2717,U+2726" \
  --layout-features="ccmp,locl,mark,mkmk" --flavor=woff2 \
  --output-file=apps/site/public/fonts/JetBrainsMono-Regular.woff2
```

Add a range when the site starts writing a character outside it.
