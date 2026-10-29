import { existsSync, readdirSync, readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const dist = new URL('../dist/', import.meta.url)
const docsDir = new URL('../src/content/docs/', import.meta.url)
const previewBuild = process.env.ACORN_SITE_PREVIEW === '1'

const filesUnder = (dir: URL) => readdirSync(dir, { recursive: true, encoding: 'utf8' })

// Every page the build wrote, as the route that serves it.
const routes = filesUnder(dist)
  .filter((file) => file.endsWith('index.html'))
  .map((file) => `/${file.replace(/index\.html$/, '')}`)

for (const route of routes) {
  test(`${route} loads without errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    const response = await page.goto(route)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1').first()).toBeVisible()
    expect(errors).toEqual([])
  })
}

const drafts = filesUnder(docsDir)
  .filter((file) => /\.mdx?$/.test(file) && /^draft: true$/m.test(readFileSync(new URL(file, docsDir), 'utf8')))
  .map((file) => `/${file.replace(/(index)?\.mdx?$/, '')}`.replace(/([^/])$/, '$1/'))

test('drafts and the lab build only for preview deploys', () => {
  const built = new Set(routes)
  for (const route of [...drafts, '/lab/']) expect(built.has(route), route).toBe(previewBuild)
})

const featureRoutes = routes.filter((route) => route.startsWith('/features/'))

// Every claim on the landing page and the feature pages links to the docs page that owns it, so a
// renamed page fails here.
// shortcut: preview builds only, because most of those docs pages are drafts until their phases publish
// them; run it on both builds once they're published.
for (const route of ['/', '/download/', ...featureRoutes]) {
  test(`every link on ${route} goes to a page the build wrote`, async ({ page }) => {
    test.skip(!previewBuild, 'The docs pages these pages link to are drafts, which only a preview build has.')
    await page.goto(route)
    const hrefs = await page
      .locator('main a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))
    const built = new Set(routes)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of new Set(hrefs)) expect(built.has(href.replace(/#.*$/, '')), href).toBe(true)
  })
}

// Every plugin on /plugins/ links to its docs page, and those are all published, so this runs on both builds.
test('every link on /plugins/ goes to a page the build wrote', async ({ page }) => {
  await page.goto('/plugins/')
  const hrefs = await page
    .locator('main a[href^="/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))
  const built = new Set(routes)
  expect(hrefs.length).toBeGreaterThan(0)
  for (const href of new Set(hrefs)) expect(built.has(href.replace(/#.*$/, '')), href).toBe(true)
})

test('an unknown address offers the docs home and the search box', async ({ page }) => {
  const response = await page.goto('/no-such-page/')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('link', { name: 'docs home' })).toHaveAttribute('href', '/docs/')
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
})

// The download page with the fixture releases in apps/site/src/lib/releaseFixtures.ts, because GitHub has none.
test('with no release, the download page says so and puts Build from source first', async ({ page }) => {
  test.skip(!previewBuild, 'The fixture releases are lab pages, which only a preview build has.')
  await page.goto('/lab/download/none/')
  await expect(page.locator('main > .callout').first()).toContainText('acorn has no signed release.')
  await expect(page.locator('main h2').first()).toHaveText('Build from source')
  await expect(page.locator('main a[href^="/download/"]')).toHaveCount(0)
})

// Each button goes to a path that src/worker.ts counts and redirects. src/worker.test.ts checks the redirects.
test('with a release for every platform, the download page links every file', async ({ page }) => {
  test.skip(!previewBuild, 'The fixture releases are lab pages, which only a preview build has.')
  await page.goto('/lab/download/every-platform/')
  const paths = {
    'macOS, Apple silicon': '/download/macos-arm64',
    'macOS, Intel': '/download/macos-x64',
    'Windows installer': '/download/windows',
    'Standalone Node': '/download/node',
    Checksums: '/download/checksums',
  }
  for (const [name, path] of Object.entries(paths)) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', path)
  }
  await expect(page.getByText('acorn has no signed release.')).toHaveCount(0)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
})

test("the download page puts the visitor's platform first", async ({ page }) => {
  test.skip(!previewBuild, 'The fixture releases are lab pages, which only a preview build has.')
  // Every visit names its platform, or names none, because the browser running the test reports its own.
  const headingsOn = async (platform: string | undefined) => {
    const tab = await page.context().newPage()
    await tab.addInitScript(
      (platform) =>
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: () => (platform ? { platform } : undefined),
        }),
      platform,
    )
    await tab.goto('/lab/download/every-platform/')
    return tab.locator('main h2').allTextContents()
  }
  const linuxOrder = await headingsOn('Linux')
  expect(linuxOrder).toEqual([
    'Terminal client and command line',
    'Standalone Node',
    'Build from source',
    'Desktop app',
    'Browser extension',
  ])
  expect(await headingsOn(undefined)).not.toEqual(linuxOrder)
})

test('the changelog feed has an item for every entry on the page', async ({ page, request }) => {
  const feed = await (await request.get('/changelog/rss.xml')).text()
  await page.goto('/changelog/')
  const anchors = await page.locator('article[id]').evaluateAll((entries) => entries.map((entry) => entry.id))
  expect(anchors.length).toBeGreaterThan(0)
  expect([...feed.matchAll(/<guid[^>]*>[^<]*#([^<]+)<\/guid>/g)].map((match) => match[1])).toEqual(anchors)
})

// The star count shows from 100 stars.
test('the star button hides the count at 99 stars', async ({ page }) => {
  test.skip(!previewBuild, 'The design gallery is a lab page, which only a preview build has.')
  await page.goto('/lab/design/')
  await expect(page.getByTestId('stars').getByRole('link').nth(0)).toHaveAccessibleName('Star on GitHub')
})

test('the star button shows the count from 100 stars', async ({ page }) => {
  test.skip(!previewBuild, 'The design gallery is a lab page, which only a preview build has.')
  await page.goto('/lab/design/')
  const links = page.getByTestId('stars').getByRole('link')
  await expect(links.nth(1)).toHaveAccessibleName('Star on GitHub 100 stars')
  await expect(links.nth(2)).toHaveAccessibleName('Star on GitHub 1.2k stars')
})

// One page of each template, a marketing page, a docs page, and Starlight's splash page, and every
// feature page, because each draws its own pictures. The plugins page and a plugin's page, for the
// cards and the facts box.
const axeRoutes = [
  '/',
  '/docs/',
  '/no-such-page/',
  '/download/',
  '/changelog/',
  '/plugins/',
  '/docs/built-in-plugins/database/',
]
// A picture of acorn in a frame is the kit's markup in the site's theme, drawn exactly as the app draws
// it, so a finding there belongs to the kit or the theme, as on the galleries below. Catppuccin Latte's
// muted text and accent buttons sit just under 4.5:1 there.
// With reduced motion, so axe reads each block where it settles, not partway through rising into view.
for (const route of [...axeRoutes, ...featureRoutes]) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(route)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('.frame .acorn-ui')
      .analyze()
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  })
}

// The specimen stylesheet applies only inside `.acorn-ui`, so a page with specimens draws the site's
// own header, sidebar, and text exactly as a page without them does.
test('specimens leave the site around them unchanged', async ({ page }) => {
  test.skip(!previewBuild, 'The specimen gallery is a lab page, which only a preview build has.')
  const PROPERTIES = ['font-family', 'font-size', 'line-height', 'color', 'background-color', 'margin', 'padding']
  const styles = async (route: string) => {
    await page.goto(route)
    return page.evaluate((properties) => {
      const read = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!)
        return properties.map((property) => style.getPropertyValue(property))
      }
      return {
        header: read('header.header'),
        sidebar: read('#starlight__sidebar'),
        text: read('.sl-markdown-content p'),
      }
    }, PROPERTIES)
  }
  const gallery = await styles('/lab/specimens/')
  expect(await page.locator('.acorn-ui').count()).toBeGreaterThan(0)
  expect(gallery).toEqual(await styles('/docs/'))
})

// The frame around each specimen, not the specimen: what's inside `.acorn-ui` is the app's own markup,
// drawn exactly as the app draws it, so a finding there belongs to the kit.
// Shell snapshots are the same: the window inside each frame is the app's.
for (const route of ['/lab/specimens/', '/lab/snapshots/']) {
  test(`the frames on ${route} have no serious accessibility violations`, async ({ page }) => {
    test.skip(!previewBuild, 'The galleries are lab pages, which only a preview build has.')
    await page.goto(route)
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.acorn-ui').analyze()
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  })
}

// The design gallery's own components, around the specimens. Inside a specimen is the kit's markup, as
// above, but the site's own badges and keys also carry `.acorn-ui`, so only the specimens are left out.
for (const route of ['/lab/design/', '/lab/design/docs/', '/lab/design/landing/']) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    test.skip(!previewBuild, 'The design gallery is a lab page, which only a preview build has.')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(route)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('.specimen .acorn-ui')
      .analyze()
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  })
}

for (const route of ['/', '/docs/']) {
  test(`the light and dark switch on ${route} restyles the page without a reload`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(route)
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'catppuccin-latte')
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const before = await background()
    await page.getByRole('button', { name: 'Dark theme' }).click()
    expect(await background()).not.toBe(before)
    await expect(html).toHaveAttribute('data-theme', 'catppuccin-mocha')
    await expect(html).toHaveAttribute('data-color-scheme', 'dark')
    await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true')
    await expect(html).not.toHaveAttribute('data-style')
  })
}

// A saved choice is on <html> by the first frame, so a reload never draws the other theme first.
test('a saved choice applies before the first frame, over the system mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    localStorage.setItem('acorn-scheme', 'dark')
    requestAnimationFrame(() => {
      const { theme, colorScheme } = document.documentElement.dataset
      Object.assign(window, { firstFrame: { theme, colorScheme } })
    })
  })
  await page.goto('/docs/')
  expect(await page.evaluate(() => (window as unknown as { firstFrame: object }).firstFrame)).toEqual({
    theme: 'catppuccin-mocha',
    colorScheme: 'dark',
  })
})

// The published JSON Schemas, each served where its `$id` says it is.
const schemaFiles = [
  ...readdirSync(new URL('../../../packages/plugin-types/', import.meta.url)).filter((name) =>
    name.endsWith('.schema.json'),
  ),
  ...readdirSync(new URL('../../cli/schemas/', import.meta.url))
    .filter((name) => name.endsWith('.schema.json'))
    .map((name) => `cli/${name}`),
]
for (const file of schemaFiles) {
  test(`/schemas/${file} is served at its $id`, async ({ request }) => {
    const response = await request.get(`/schemas/${file}`)
    expect(response.status()).toBe(200)
    expect((await response.json()).$id).toBe(`https://getacorn.dev/schemas/${file}`)
  })
}

// What a page tells a search engine, a chat app, and an agent (docs/site/agent-outputs.md), read from the
// files the build wrote. The lab is left out, because it's never published.
const publishedHtml = filesUnder(dist).filter((file) => file.endsWith('.html') && !file.startsWith('lab/'))
const docsRoutes = routes.filter((route) => route.startsWith('/docs/'))

test('every page has a title and a description no other page has, and a card the build wrote', () => {
  const seen = { title: new Map<string, string>(), description: new Map<string, string>() }
  const problems: string[] = []
  for (const file of publishedHtml) {
    const html = readFileSync(new URL(file, dist), 'utf8')
    const found = {
      title: html.match(/<title>([^<]*)<\/title>/)?.[1],
      description: html.match(/<meta name="description" content="([^"]*)"/)?.[1],
    }
    for (const key of ['title', 'description'] as const) {
      const value = found[key]
      if (!value) problems.push(`${file} has no ${key}`)
      else if (seen[key].has(value)) problems.push(`${file} has the same ${key} as ${seen[key].get(value)}: ${value}`)
      else seen[key].set(value, file)
    }
    const card = html.match(/<meta property="og:image" content="https:\/\/getacorn\.dev\/([^"]+)"/)?.[1]
    if (!card) problems.push(`${file} has no og:image`)
    else if (!existsSync(new URL(card, dist)))
      problems.push(`${file} points og:image at ${card}, which the build didn't write`)
  }
  expect(problems).toEqual([])
})

test('every docs page is Markdown at its URL plus .md, and in /llms-full.txt', () => {
  const full = readFileSync(new URL('llms-full.txt', dist), 'utf8')
  for (const route of docsRoutes) {
    const markdown = readFileSync(new URL(`.${route.replace(/\/$/, '')}.md`, dist), 'utf8').trimEnd()
    expect(markdown, route).toMatch(/^# .+\n\n> .+\n\n/)
    expect(full.includes(markdown), `${route} isn't in /llms-full.txt as its .md copy has it`).toBe(true)
  }
})

test('/llms-small.txt leaves out the generated component pages', () => {
  const small = readFileSync(new URL('llms-small.txt', dist), 'utf8')
  expect(small).toContain('# One kit, two hosts')
  expect(small).not.toContain('# IconButton')
})

test('every getacorn.dev link in the agent guide goes to a file the build wrote', () => {
  const guide = readFileSync(new URL('agent-guide.md', dist), 'utf8')
  const paths = [...guide.matchAll(/https:\/\/getacorn\.dev(\/[^)\s]*)/g)].map(([, path]) => path)
  expect(paths.length).toBeGreaterThan(0)
  for (const path of paths) expect(existsSync(new URL(`.${path.replace(/\/$/, '/index.html')}`, dist)), path).toBe(true)
})

// Pagefind indexes a page only when Starlight marks its body, so this counts what search can find.
test('search indexes every published docs page, and no draft or lab page', () => {
  const entry = JSON.parse(readFileSync(new URL('pagefind/pagefind-entry.json', dist), 'utf8'))
  const unpublished = new Set(drafts)
  expect(entry.languages.en.page_count).toBe(docsRoutes.filter((route) => !unpublished.has(route)).length)
})

// The search script is a module, so it runs after the page loads, and a key pressed before then does nothing.
const searchReady = (page: Page) => page.waitForFunction(() => customElements.get('site-search'))

// A contribution key, a component, a setting's label, and a command, each searched for by name.
const searches = {
  contentLinks: '/docs/build-plugins/reference/contributions/content-links/',
  IconButton: '/docs/components/inputs/icon-button/',
  'Show workspace rail': '/docs/settings/general/',
  'acorn task list': '/docs/reference/command-line-reference/',
}
for (const [query, route] of Object.entries(searches)) {
  test(`searching for ${query} puts ${route} first`, async ({ page }) => {
    await page.goto('/docs/')
    await searchReady(page)
    await page.keyboard.press('/')
    await page.getByRole('combobox', { name: 'Search the docs' }).fill(query)
    await expect(page.locator('#search-results [role="option"]').first()).toHaveAttribute('href', route)
  })
}

test('search opens from the keyboard, groups its results, and goes to the selected one', async ({ page }) => {
  await page.goto('/download/')
  await searchReady(page)
  const dialog = page.getByRole('dialog', { name: 'Search the docs' })
  await page.keyboard.press('Control+k')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.keyboard.press('/')
  await page.keyboard.type('contentLinks')
  await expect(dialog.getByRole('group').first()).toHaveAccessibleName('Build plugins · Reference')
  await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  const { violations } = await new AxeBuilder({ page })
    .include('site-search dialog')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/content-links\/$/)
})

test('/ types into a text field instead of opening search', async ({ page }) => {
  await page.goto('/docs/')
  await searchReady(page)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('a/b')
  await expect(page.getByRole('combobox', { name: 'Search the docs' })).toHaveValue('a/b')
})

// The landing and download pages describe acorn as an app, for search engines.
for (const route of ['/', '/download/']) {
  test(`${route} carries acorn's structured data`, async ({ request }) => {
    const html = await (await request.get(route)).text()
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)![1]!)
    expect(data).toMatchObject({
      '@type': 'SoftwareApplication',
      name: 'acorn',
      operatingSystem: 'macOS, Windows, Linux',
    })
  })
}
