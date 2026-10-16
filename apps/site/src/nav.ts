// The site's navigation: the header's links, the footer's sitemap, and which header section a page
// belongs to. The docs have two sidebars, Docs and Build plugins, split by URL (see `isBuildPath`).

export const GITHUB = 'https://github.com/jamesmacfie/acorn'

/** The header's links. `id` is the section that marks one as current. */
export const headerLinks = [
  { id: 'docs', label: 'Docs', href: '/docs/' },
  { id: 'build', label: 'Build plugins', href: '/docs/build-plugins/start/build-your-first-plugin/' },
  { id: 'download', label: 'Download', href: '/download/' },
  { id: 'changelog', label: 'Changelog', href: '/changelog/' },
]

export const footerColumns = [
  {
    label: 'acorn',
    links: [
      ['Features', '/features/'],
      ['Download', '/download/'],
      ['Changelog', '/changelog/'],
      ['Plugins', '/plugins/'],
    ],
  },
  {
    label: 'Use acorn',
    links: [
      ['What is acorn', '/docs/'],
      ['Install', '/docs/start/install/'],
      ['Agent sessions', '/docs/agents/agent-sessions/'],
      ['Security', '/docs/security/the-trust-model/'],
    ],
  },
  {
    label: 'Build plugins',
    links: [
      ['Build your first plugin', '/docs/build-plugins/start/build-your-first-plugin/'],
      ['Add a pane', '/docs/build-plugins/ui/add-a-pane/'],
      ['Manifest reference', '/docs/build-plugins/reference/manifest-reference/'],
      ['Components', '/docs/components/one-kit-two-hosts/'],
    ],
  },
  {
    label: 'Project',
    links: [
      ['GitHub', GITHUB],
      ['FAQ', '/docs/help/faq/'],
      ['Troubleshooting', '/docs/help/troubleshooting/'],
      ['MIT license', `${GITHUB}/blob/main/LICENSE`],
    ],
  },
]

/** Is this docs page in the Build plugins sidebar, rather than the Docs one? */
export const isBuildPath = (path: string) => /^\/docs\/(?:build-plugins|components)\//.test(path)

/** The header link a page sits under, if any. */
export function sectionOf(path: string) {
  if (isBuildPath(path)) return 'build'
  return headerLinks.find(({ href }) => path.startsWith(href))?.id
}

type SidebarEntry = { type: 'link'; isCurrent: boolean } | { type: 'group'; label: string; entries: SidebarEntry[] }
const holdsCurrent = (entry: SidebarEntry): boolean =>
  entry.type === 'link' ? entry.isCurrent : entry.entries.some(holdsCurrent)

/** The top-level sidebar group a docs page sits in: the label search groups its results under, and the
 *  name of the social card in public/og/. Both halves have a Reference group, so a Build plugins group
 *  carries the half's name in both. */
export function docsSection(sidebar: SidebarEntry[], path: string) {
  const group = sidebar.find(holdsCurrent)
  if (group?.type !== 'group') return undefined
  const build = isBuildPath(path)
  const slug = group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return {
    label: build ? `Build plugins · ${group.label}` : group.label,
    card: `${build ? 'build-plugins' : 'docs'}-${slug}`,
  }
}
