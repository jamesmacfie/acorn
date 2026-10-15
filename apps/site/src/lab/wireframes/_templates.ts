// The 14 templates phase 5 wireframes, in its order, with the pages that show each one.
export const templates: { name: string; pages: [label: string, page: string][] }[] = [
  { name: 'Landing', pages: [['Landing', 'landing']] },
  {
    name: 'Features index and feature page',
    pages: [
      ['Features', 'features'],
      ['Agents', 'features-agents'],
    ],
  },
  {
    name: 'Download',
    pages: [
      ['No release', 'download/no-release'],
      ['A release', 'download/release'],
    ],
  },
  { name: 'Changelog', pages: [['Changelog', 'changelog']] },
  { name: 'Plugins directory', pages: [['Plugins', 'plugins']] },
  { name: 'Docs home', pages: [['What is acorn', 'docs-home']] },
  { name: 'Docs guide page', pages: [['Add a pane', 'docs-guide']] },
  { name: 'Docs reference page', pages: [['Manifest reference', 'docs-reference']] },
  { name: 'Component page', pages: [['Button', 'component']] },
  { name: 'Built-in plugin page', pages: [['Database', 'built-in-plugin']] },
  { name: 'Tutorial page', pages: [['Build your first plugin', 'tutorial']] },
  { name: 'Search', pages: [['Search', 'search']] },
  { name: 'Header, footer, and mobile navigation', pages: [['Header and footer', 'chrome']] },
  { name: '404', pages: [['Page not found', 'not-found']] },
]
