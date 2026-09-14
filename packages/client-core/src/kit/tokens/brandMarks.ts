import { Registry } from '../lib/registry'

// A brand logo, as one SVG path's `d` attribute in a 24x24 box, not an SVG document. See
// docs/ui-design.md § Icons for why, and docs/future/icons.md (git history) for the alternatives
// this rules out.
export type BrandMark = {
  // Bare for a core mark, `<pluginId>` or `<pluginId>/<key>` for a plugin's. Icon looks it up under
  // a `brand:` prefix; the prefix keeps these out of ICON_NAMES and stays unambiguous if Lucide ever
  // grows names like `figma` back.
  id: string
  d: string
  // The brand's own colour, six-digit hex. Optional: a mark without one keeps the host surface's
  // colours, which is what a monochrome glyph such as a tool logo usually wants.
  color?: string
}

// Icon looks a mark up under this prefix. See docs/ui-design.md section Icons.
export const BRAND = 'brand:'

// Registry rather than a plain map: a loaded plugin's mark arrives and leaves with its roster row,
// and Registry already gives disposal plus the duplicate-id throw that plugins/chrome/register.ts
// catches. Its `get` reads a signal, so a mark registering after first paint re-renders the icon.
export const brandMarkRegistry = new Registry<BrandMark>('brand mark')

// Core's own marks. See docs/ui-design.md § Icons for the "core iff a core surface renders it"
// rule.
const CORE: BrandMark[] = [
  // See docs/ui-design.md § Icons for why this stays core's. Replaces the hand-inlined
  // ui/GithubMark.tsx. From simple-icons (CC0 artwork; the trademark remains GitHub's).
  {
    id: 'github',
    color: '#24292f',
    d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  // Settings → Integrations draws this beside any connection whose credential is a 1Password
  // reference, so by the rule above it is core's. From simple-icons (CC0 artwork; the trademark
  // remains AgileBits').
  {
    id: 'onepassword',
    color: '#0094F5',
    d: 'M12 .007C5.373.007 0 5.376 0 11.999c0 6.624 5.373 11.994 12 11.994S24 18.623 24 12C24 5.376 18.627.007 12 .007Zm-.895 4.857h1.788c.484 0 .729.002.914.096a.86.86 0 0 1 .377.377c.094.185.095.428.095.912v6.016c0 .12 0 .182-.015.238a.427.427 0 0 1-.067.137.923.923 0 0 1-.174.162l-.695.564c-.113.092-.17.138-.191.194a.216.216 0 0 0 0 .15c.02.055.078.101.191.193l.695.565c.094.076.14.115.174.162.03.042.053.087.067.137a.936.936 0 0 1 .015.238v2.746c0 .484-.001.727-.095.912a.86.86 0 0 1-.377.377c-.185.094-.43.096-.914.096h-1.788c-.484 0-.726-.002-.912-.096a.86.86 0 0 1-.377-.377c-.094-.185-.095-.428-.095-.912v-6.016c0-.12 0-.182.015-.238a.437.437 0 0 1 .067-.139c.034-.047.08-.083.174-.16l.695-.564c.113-.092.17-.138.191-.194a.216.216 0 0 0 0-.15c-.02-.055-.078-.101-.191-.193l-.695-.565a.92.92 0 0 1-.174-.162.437.437 0 0 1-.067-.139.92.92 0 0 1-.015-.236V6.25c0-.484.001-.727.095-.912a.86.86 0 0 1 .377-.377c.186-.094.428-.096.912-.096z',
  },
]

for (const mark of CORE) brandMarkRegistry.register(mark)

// A mark's colour, as the two custom properties its surfaces style against: `--brand` for the fill and
// `--brand-on` for whatever sits on top of it. Read them with a fallback, `var(--brand, var(--accent))`,
// so a mark with no colour and a plain Lucide name both keep the surface's own look. Colour reaches CSS
// this way rather than as a token per provider, because core cannot know a third party's hex and a rule
// keyed to a provider name is closed to plugins. See docs/ui-design.md section Brand colour.
//
// Returns undefined rather than an empty object so Solid drops the `style` attribute entirely, and takes
// the full icon name so a caller can pass whatever it was going to hand `Icon` anyway.
export function brandStyle(name: string): Record<string, string> | undefined {
  const color = name.startsWith(BRAND) ? brandMarkRegistry.get(name.slice(BRAND.length))?.color : undefined
  return color ? { '--brand': color, '--brand-on': 'var(--brand-fg)' } : undefined
}
