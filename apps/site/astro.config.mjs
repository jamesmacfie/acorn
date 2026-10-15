import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { unified } from '@astrojs/markdown-remark'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'
import { acornUi } from './scripts/acornUi.mjs'

// Drafts and /lab/ pages show in `astro dev` and on preview deploys, and never in production.
const previewBuild = process.env.ACORN_SITE_PREVIEW === '1'
const showDrafts = previewBuild || !process.argv.includes('build')

const docsDir = new URL('./src/content/docs/', import.meta.url)
const labDir = new URL('./src/lab/', import.meta.url)

// Starlight drops drafts from a production build and then fails on any sidebar slug it can't find, so
// the sidebar leaves drafts out too.
// shortcut: reads `draft: true` with a regex instead of parsing frontmatter, fine while stubs are
// generated in one shape; parse the YAML if pages start writing `draft` another way.
function published(slug) {
  if (showDrafts) return true
  const file = [`${slug}.md`, `${slug}.mdx`, `${slug}/index.md`, `${slug}/index.mdx`]
    .map((name) => new URL(name, docsDir))
    .find(existsSync)
  return !/^draft: true$/m.test(readFileSync(file, 'utf8'))
}

// A group keeps its published pages, and a group left with none is dropped.
function group({ label, items }) {
  const kept = items.flatMap((item) => (typeof item !== 'string' ? group(item) : published(item) ? [item] : []))
  return kept.length > 0 ? [{ label, items: kept }] : []
}

// Lab pages live outside src/pages so a production build never sees them. A file whose name starts
// with `_` is a component, not a page, as in src/pages.
const lab = {
  name: 'acorn-lab',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      if (!showDrafts) return
      const pages = readdirSync(labDir, { recursive: true }).filter(
        (name) => name.endsWith('.astro') && !/(^|\/)_/.test(name),
      )
      for (const file of pages) {
        const route = file.replace(/(^|\/)index\.astro$/, '').replace(/\.astro$/, '')
        injectRoute({ pattern: `/lab/${route}`, entrypoint: new URL(file, labDir) })
      }
    },
  },
}

export default defineConfig({
  site: 'https://acorn.sh',
  output: 'static',
  integrations: [
    lab,
    starlight({
      title: 'acorn',
      description: 'An agent workspace for developers who work with coding agents.',
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jamesmacfie/acorn' }],
      plugins: [starlightLinksValidator()],
      editLink: { baseUrl: 'https://github.com/jamesmacfie/acorn/edit/main/apps/site/' },
      lastUpdated: true,
      pagination: true,
      // The app's tokens, then the site's own sheet (src/styles/site.css), on every docs page.
      customCss: ['virtual:acorn-ui.css', './src/styles/site.css'],
      // acorn's header, sidebars, title, footer, and Appearance control in place of Starlight's.
      components: {
        Footer: './src/components/starlight/Footer.astro',
        Header: './src/components/starlight/Header.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
        Sidebar: './src/components/starlight/Sidebar.astro',
        ThemeProvider: './src/components/starlight/ThemeProvider.astro',
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
      },
      // The groups and their order follow the site map, and each page's label is its title. There are two
      // sidebars, Docs and then Build plugins, and Sidebar.astro shows a page the one it belongs to.
      sidebar: [
        {
          label: 'Start here',
          items: [
            'docs',
            'docs/start/install',
            'docs/start/quick-start-first-project-first-task-first-agent',
            'docs/start/concepts',
            'docs/start/desktop-and-terminal',
          ],
        },
        {
          label: 'Using acorn',
          items: [
            'docs/using/workspaces-and-projects',
            'docs/using/tasks-and-worktrees',
            'docs/using/task-scripts',
            'docs/using/archive-and-restore',
            'docs/using/panes',
            'docs/using/the-window-top-bar-rails-and-drawer',
            'docs/using/the-command-palette',
            'docs/using/keyboard-shortcuts',
            'docs/using/notifications-and-the-inbox',
            'docs/using/notes',
            'docs/using/memory',
            'docs/using/task-context',
            'docs/using/appearance-themes-and-styles',
            'docs/using/links-into-acorn',
            'docs/using/project-configuration',
          ],
        },
        {
          label: 'Agents',
          items: [
            'docs/agents/agent-sessions',
            'docs/agents/harnesses-and-defaults',
            'docs/agents/permissions-and-approvals',
            'docs/agents/custom-agents',
            'docs/agents/skills',
            'docs/agents/delegation-and-subagents',
            'docs/agents/steering-queues-and-follow-ups',
            'docs/agents/files-attachments-and-context',
            'docs/agents/search-agent-history',
            'docs/agents/usage-and-cost',
            'docs/agents/agents-in-the-terminal-drawer',
            'docs/agents/agent-tools-and-the-mcp-server',
            'docs/agents/model-providers-and-generating-text',
          ],
        },
        {
          label: 'Security',
          items: [
            'docs/security/the-trust-model',
            'docs/security/credentials-and-secrets',
            'docs/security/plugin-trust-and-permissions',
            'docs/security/files-processes-and-project-configuration',
            'docs/security/the-preview-and-webviews',
            'docs/security/the-audit-log',
            'docs/security/telemetry-and-privacy',
            'docs/security/security-diagnostics',
            'docs/security/what-acorn-doesnt-protect-against',
          ],
        },
        {
          label: 'Settings',
          items: [
            'docs/settings',
            'docs/settings/general',
            'docs/settings/workspaces-and-projects',
            'docs/settings/agents',
            'docs/settings/connections',
            'docs/settings/features',
            'docs/settings/automation',
            'docs/settings/machines',
            'docs/settings/plugins',
            'docs/settings/advanced',
          ],
        },
        {
          label: 'Built-in plugins',
          items: [
            'docs/built-in-plugins',
            'docs/built-in-plugins/agents',
            'docs/built-in-plugins/agent-browser',
            'docs/built-in-plugins/agent-cost',
            'docs/built-in-plugins/context',
            'docs/built-in-plugins/database',
            'docs/built-in-plugins/docker',
            'docs/built-in-plugins/editor',
            'docs/built-in-plugins/git',
            'docs/built-in-plugins/github',
            'docs/built-in-plugins/http',
            'docs/built-in-plugins/linear',
            'docs/built-in-plugins/memory',
            'docs/built-in-plugins/model-providers',
            'docs/built-in-plugins/notes',
            'docs/built-in-plugins/preview',
            'docs/built-in-plugins/rollbar',
            'docs/built-in-plugins/sentry-telemetry',
            'docs/built-in-plugins/terminal',
            'docs/built-in-plugins/workflows',
          ],
        },
        {
          label: 'Nodes and devices',
          items: [
            'docs/nodes',
            'docs/nodes/pair-a-device-or-a-remote-node',
            'docs/nodes/run-a-standalone-node',
            'docs/nodes/the-fleet-view',
            'docs/nodes/where-your-data-lives',
            'docs/nodes/back-up-and-restore',
          ],
        },
        {
          label: 'Browser extension',
          items: [
            'docs/browser-extension/set-up-the-extension',
            'docs/browser-extension/talk-to-an-agent-from-the-browser',
            'docs/browser-extension/send-pages-selections-and-screenshots',
            'docs/browser-extension/ask-about-an-element',
            'docs/browser-extension/task-chips-and-handoffs',
            'docs/browser-extension/project-sites',
            'docs/browser-extension/workflows-and-plugin-panels',
            'docs/browser-extension/waiting-requests-and-notifications',
          ],
        },
        {
          label: 'Automation',
          items: [
            'docs/automation/workflows',
            'docs/automation/write-a-workflow',
            'docs/automation/steps-gates-and-budgets',
            'docs/automation/start-and-schedule-runs',
            'docs/automation/schedules',
            'docs/automation/dashboards',
            'docs/automation/data-sources-and-saved-queries',
            'docs/automation/the-command-line',
          ],
        },
        {
          label: 'Reference',
          items: [
            'docs/reference/command-line-reference',
            'docs/reference/keyboard-shortcuts-reference',
            'docs/reference/configuration-files',
            'docs/reference/environment-variables',
            'docs/reference/json-schemas',
            'docs/reference/glossary',
          ],
        },
        {
          label: 'Help',
          items: [
            'docs/help/troubleshooting',
            'docs/help/faq',
            'docs/help/known-limits',
          ],
        },
        // The Build plugins sidebar: every group from here down. src/nav.ts splits the two by URL.
        {
          label: 'Start',
          items: [
            'docs/build-plugins/start/how-plugins-work',
            'docs/build-plugins/start/build-your-first-plugin',
            'docs/build-plugins/start/have-your-agent-build-it',
            'docs/build-plugins/start/choose-how-your-plugin-draws',
          ],
        },
        {
          label: 'Draw in acorn',
          items: [
            'docs/build-plugins/ui/add-a-pane',
            'docs/build-plugins/ui/add-a-source-to-the-left-rail',
            'docs/build-plugins/ui/put-your-pane-in-the-right-rail',
            'docs/build-plugins/ui/add-a-reference-panel',
            'docs/build-plugins/ui/add-a-settings-page',
            'docs/build-plugins/ui/add-commands-and-keybindings',
            'docs/build-plugins/ui/add-rows-to-context-menus',
            'docs/build-plugins/ui/put-a-badge-in-the-top-bar-or-task-footer',
            'docs/build-plugins/ui/mark-tasks-sources-and-panes',
            'docs/build-plugins/ui/add-to-another-plugins-view',
            'docs/build-plugins/ui/open-your-view-to-other-plugins',
            'docs/build-plugins/ui/add-a-toolbar-control',
            'docs/build-plugins/ui/preview-links-and-draw-code-fences',
            'docs/build-plugins/ui/view-files-and-agent-attachments',
            'docs/build-plugins/ui/replace-the-top-bar-rail-or-pane-switcher',
            'docs/build-plugins/ui/draw-your-own-pixels-in-a-frame',
            'docs/build-plugins/ui/show-a-web-page',
            'docs/build-plugins/ui/add-a-theme-or-a-style-pack',
            'docs/build-plugins/ui/add-icons-and-brand-marks',
            'docs/build-plugins/ui/notify-the-person',
          ],
        },
        {
          label: 'Node, agents, data, and the browser',
          items: [
            'docs/build-plugins/node/write-the-node-half',
            'docs/build-plugins/node/store-data',
            'docs/build-plugins/node/use-events-and-talk-to-other-plugins',
            'docs/build-plugins/node/connect-a-service',
            'docs/build-plugins/node/give-agents-tools',
            'docs/build-plugins/node/add-task-context',
            'docs/build-plugins/node/add-a-harness',
            'docs/build-plugins/node/ship-custom-agents-and-skills',
            'docs/build-plugins/node/generate-text-with-a-model',
            'docs/build-plugins/node/act-on-agent-turns-with-hooks',
            'docs/build-plugins/node/add-a-data-source',
            'docs/build-plugins/node/add-a-workflow-step',
            'docs/build-plugins/node/run-work-on-a-schedule',
            'docs/build-plugins/node/check-a-task-before-its-archived',
            'docs/build-plugins/node/add-a-command-line-command',
            'docs/build-plugins/node/add-hover-and-diagnostics-for-a-language',
            'docs/build-plugins/node/bring-a-websites-item-into-a-task',
            'docs/build-plugins/node/show-a-panel-in-the-browser-sidebar',
            'docs/build-plugins/node/log-and-measure',
            'docs/build-plugins/node/test-your-plugin',
            'docs/build-plugins/node/install-update-and-share',
          ],
        },
        {
          label: 'Reference',
          items: [
            'docs/build-plugins/reference/manifest-reference',
            'docs/build-plugins/reference/contributions',
            'docs/build-plugins/reference/permissions',
            'docs/build-plugins/reference/the-node-context',
            'docs/build-plugins/reference/the-client-bridge',
            'docs/build-plugins/reference/trees-and-events',
            'docs/build-plugins/reference/extension-points',
            'docs/build-plugins/reference/action-verbs',
            'docs/build-plugins/reference/limits',
            'docs/build-plugins/reference/compatibility-and-versions',
            'docs/build-plugins/reference/what-plugins-cant-do',
            'docs/build-plugins/reference/examples',
          ],
        },
        {
          label: 'Components',
          items: [
            'docs/components/one-kit-two-hosts',
            'docs/components/roles-and-tokens',
            'docs/components/layouts',
            'docs/components/icons',
            'docs/components/themes-and-style-packs',
            'docs/components/keyboard-and-accessibility',
            'docs/components/what-the-kit-refuses',
          ],
        },
      ].flatMap(group),
    }),
  ],
  // The specimen stylesheet, `virtual:acorn-ui.css`, built from the app's own sheets.
  vite: { plugins: [acornUi()] },
  markdown: {
    // The docs are full of `--flags`, which smart typography turns into dashes.
    processor: unified({ smartypants: false }),
  },
})
