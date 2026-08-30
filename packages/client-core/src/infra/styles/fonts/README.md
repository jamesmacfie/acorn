# Bundled fonts

Latin-subset **variable** woff2 files for the non-Terminal style packs. ~196 KB total, and a
Terminal user downloads none of them: a browser fetches a `@font-face` source only when a rule
actually uses the family, so declaring all three costs nothing until a pack references one.

| File | Family | Used by | Size |
| --- | --- | --- | --- |
| `inter-var.woff2` | Inter | Modern pack (`--font-ui`) | 47 KB |
| `literata-var.woff2` | Literata | Cozy pack (`--font-ui`, `--font-display`) | 108 KB |
| `nunito-var.woff2` | Nunito | Cute pack (`--font-ui`) | 38 KB |

Terminal keeps `--font-mono` (Berkeley Mono → `ui-monospace` → …), which is not bundled: it is
either installed locally or falls back through the system stack.

Code surfaces — diffs, the terminal, Monaco, the SQL result grid, CI logs — stay on `--font-mono`
in **every** pack. Their alignment is load-bearing and xterm measures cell width from the font.

## Licensing

All three are licensed under the SIL Open Font License 1.1 (`OFL.txt`), which requires the
copyright notice and licence to ship with the software:

- Inter — Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)
- Literata — Copyright 2018 The Literata Project Authors (https://github.com/googlefonts/literata)
- Nunito — Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)

The OFL also forbids selling the fonts on their own and requires that any derivative renamed —
neither applies here, we ship them unmodified as part of the app.

## Refreshing

These are the `latin` unicode-range subsets from the Google Fonts CSS v2 API. To refresh, request
`https://fonts.googleapis.com/css2?family=<Family>:wght@<range>&display=swap` with a modern browser
User-Agent (the API serves woff2 only to UAs it knows support it) and take the `/* latin */` block's
`src` URL.
