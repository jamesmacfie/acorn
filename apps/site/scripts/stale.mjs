// Lists the written pages whose sources changed since someone last checked them (docs/site.md).
//
//   node scripts/stale.mjs [--json]                      pages with commits to their sources since `checked`
//   node scripts/stale.mjs --touching <paths…> [--json]  pages that cite any of these repository paths
//   node scripts/stale.mjs --mark <page>                 sets a page's `checked` to the current commit
//
// The reports exit 0 whatever they find, because a source edit that changes no behavior shouldn't block
// a merge.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOKS } from './books.mjs'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SITE = 'apps/site/src'
const DOCS = `${SITE}/content/docs`
// The plugin reference's and the components' pages are generated into the docs collection from written
// halves, which carry the frontmatter, so a generated page is its written half (scripts/reference.mjs).
const GENERATED = BOOKS.map((book) => ({ written: `apps/site/${book.written}`, docs: book.docs, folder: `${DOCS}/${book.docs}/` }))
const PAGES = `${SITE}/pages`
const SNAPSHOTS = `${SITE}/generated/snapshots`

// A shell snapshot is a picture of the whole window, so it's as old as the last change to the shell
// that drew it. It carries no frontmatter, so its sources are set here by the host that drew it.
const SNAPSHOT_SOURCES = {
  '.html': [
    'packages/client-core/src/host/chrome/',
    'packages/client-core/src/host/layouts/',
    'packages/client-core/src/infra/styles/',
  ],
  '.cells.json': ['apps/tui/src/chrome/', 'apps/tui/src/paint/'],
}

// Written back quoted, because YAML reads an all-digit hash as a number, which the site's schema refuses.
const CHECKED = /^(\s*checked:\s*)['"]?([0-9a-f]{7,40})['"]?/m
const SOURCES = /^\s*sources:\s*(\[[^\]]*\]|(?:\n\s*-\s.*)+)/m
const COVERS = /^\s*covers:\s*(\[[^\]]*\]|(?:\n\s*-\s.*)+)/m
// The commit a snapshot was captured at, near the top of the file: `<!-- commit 3f9a2c1, … -->` in the
// HTML, and `"commit": "3f9a2c1"` in the cells.
const SNAPSHOT_COMMIT = /\bcommit\W+([0-9a-f]{7,40})\b/

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

// A YAML list of strings, written inline as `[a, b]` or as `- a` lines.
const listItems = (list = '') =>
  list.startsWith('[')
    ? [...list.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
    : [...list.matchAll(/^\s*-\s+['"]?(.+?)['"]?\s*$/gm)].map((match) => match[1])

const headerOf = (text) => text.split(/^---$/m)[1] ?? ''

/** `sources` and `checked` from a page's header: Markdown frontmatter, or an Astro page's `meta` export. */
export function readMeta(text) {
  const header = headerOf(text)
  return { sources: listItems(header.match(SOURCES)?.[1]), checked: header.match(CHECKED)?.[2] }
}

/** The Settings page IDs a docs page's frontmatter says it documents. */
export const readCovers = (text) => listItems(headerOf(text).match(COVERS)?.[1])

export const snapshotCommit = (text) => text.slice(0, 1024).match(SNAPSHOT_COMMIT)?.[1]

function files(dir) {
  if (!existsSync(join(ROOT, dir))) return []
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  )
}

// A page at `agents/skills.md` serves `/agents/skills/`, and an `index` page serves its folder.
const urlOf = (path) => `/${path.replace(/\.(md|mdx|astro)$/, '').replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/')

/** Every page the reports cover: docs pages, the generated pages' written halves, marketing pages with a `meta`
 *  export, and shell snapshots. */
export function pages() {
  const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  const docs = files(DOCS)
    .filter((file) => /\.mdx?$/.test(file) && !GENERATED.some(({ folder }) => file.startsWith(folder)))
    .map((file) => ({ file, url: urlOf(relative(DOCS, file)), ...readMeta(read(file)) }))
  const reference = GENERATED.flatMap(({ written, docs }) =>
    files(written)
      .filter((file) => /\.mdx?$/.test(file))
      .map((file) => ({ file, url: urlOf(`${docs}/${relative(written, file)}`), ...readMeta(read(file)) })),
  )
  const marketing = files(PAGES)
    .filter((file) => file.endsWith('.astro') && read(file).includes('export const meta'))
    .map((file) => ({ file, url: urlOf(relative(PAGES, file)), ...readMeta(read(file)) }))
  const snapshots = files(SNAPSHOTS).flatMap((file) => {
    const suffix = Object.keys(SNAPSHOT_SOURCES).find((ending) => file.endsWith(ending))
    return suffix ? [{ file, sources: SNAPSHOT_SOURCES[suffix], checked: snapshotCommit(read(file)) }] : []
  })
  return [...docs, ...reference, ...marketing, ...snapshots]
}

/** Each page with commits to its sources after `checked`, newest first. */
export function stale(all = pages()) {
  return all.flatMap((page) => {
    let log
    try {
      log = git('log', '--format=%h %s', `${page.checked}..HEAD`, '--', ...page.sources)
    } catch {
      throw new Error(`${page.file}: checked ${page.checked} isn't a commit in this checkout's history`)
    }
    const commits = log
      ? log.split('\n').map((line) => ({ hash: line.split(' ', 1)[0], subject: line.slice(line.indexOf(' ') + 1) }))
      : []
    return commits.length > 0 ? [{ ...page, commits }] : []
  })
}

const cites = (source, path) => path === source || path.startsWith(source.endsWith('/') ? source : `${source}/`)

/** Each page that cites one of `paths`, a file itself or a folder holding it, with the paths it cites. */
export function touching(paths, all = pages()) {
  return all.flatMap((page) => {
    const cited = paths.filter((path) => page.sources.some((source) => cites(source, path)))
    return cited.length > 0 ? [{ ...page, cited }] : []
  })
}

function mark(target) {
  const page = pages().find((page) => page.url && [page.file, page.url, page.url.replace(/\/$/, '')].includes(target))
  if (!page)
    throw new Error(
      `No written page is ${target}. Name it by its file or its URL. A snapshot clears when it's recaptured.`,
    )
  const head = git('rev-parse', '--short', 'HEAD')
  const path = join(ROOT, page.file)
  writeFileSync(path, readFileSync(path, 'utf8').replace(CHECKED, `$1'${head}'`))
  console.log(`${page.url} is checked at ${head}.`)
}

function print(found, json, empty, details) {
  if (json) return console.log(JSON.stringify(found, null, 2))
  if (found.length === 0) return console.log(empty)
  for (const page of found) {
    const lines = [page.url ? `${page.url}  ${page.file}` : page.file, ...details(page).map((line) => `  ${line}`)]
    console.log(lines.join('\n'))
  }
}

function main(args) {
  const json = args.includes('--json')
  const paths = args.filter((arg) => !arg.startsWith('--'))

  if (args.includes('--mark')) {
    if (paths.length !== 1) throw new Error('Usage: stale --mark <page file or URL>')
    mark(paths[0])
  } else if (args.includes('--touching')) {
    if (paths.length === 0) throw new Error('Usage: stale --touching <repository paths…>')
    print(touching(paths), json, 'No page cites these files.', (page) => page.cited.map((path) => `cites ${path}`))
  } else {
    const empty = "No page's sources changed since it was checked."
    print(stale(), json, empty, (page) => page.commits.map((commit) => `${commit.hash} ${commit.subject}`))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
