import { Registry } from '../registries/registry'

// A brand logo, as one SVG path's `d` attribute in a 24x24 box — deliberately not an SVG document.
//
// A document would mean `<script>`, `<use href>`, `<image href>`, `<foreignObject>`, `on*` handlers
// and CSS `@import`: an allowlist parser and a new trust boundary, for a logo. There is nothing in
// `d`'s grammar to sanitise, which is why a manifest-supplied mark needs only a character-class
// check (node-core/main/pluginManifest.ts) and why this can render through the same `<path>`
// machinery Icon.tsx already had. Icon fills it with `currentColor`, so a plugin's mark themes
// across every theme exactly as a first-party one does — which a data-URI `<img>` could not, since
// CSS does not cross into its document.
//
// See docs/ui-design.md § Icons; the retired docs/future/icons.md (git history) records the
// alternatives this rules out.
export type BrandMark = {
  // Bare for a core mark, `<pluginId>` or `<pluginId>/<key>` for a plugin's. Icon looks it up under
  // a `brand:` prefix; the prefix keeps these out of ICON_NAMES and stays unambiguous if Lucide ever
  // grows names like `figma` back.
  id: string
  d: string
}

// Registry rather than a plain map: a loaded plugin's mark arrives and leaves with its roster row,
// and Registry already gives disposal plus the duplicate-id throw that plugins/chrome/register.ts
// catches. Its `get` reads a signal, so a mark registering after first paint re-renders the icon.
export const brandMarkRegistry = new Registry<BrandMark>('brand mark')

// CORE'S OWN MARKS. A mark is here if and only if a core surface renders it — core cannot name a
// mark and hope some plugin registered it, because Icon's fallback would print the literal string
// `brand:github` into a settings row. Everything else belongs to the plugin that draws it.
const CORE: BrandMark[] = [
  // Core draws this for `project.github` in workspaces/WorkspaceProjectAssignments.tsx, and the
  // field is first-class on the project row. The mark follows the data model, not the plugin
  // boundary, so this stays core's even if GitHub becomes a plugin. Replaces the hand-inlined
  // ui/GithubMark.tsx. From simple-icons (CC0 artwork; the trademark remains GitHub's).
  {
    id: 'github',
    d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
]

for (const mark of CORE) brandMarkRegistry.register(mark)
