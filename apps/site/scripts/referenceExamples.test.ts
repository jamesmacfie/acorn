// Every manifest example in the plugin docs parses with the Node's own parser, cross-field rules
// included, and the reference has an example for every manifest key, contribution key, and public
// extension point (docs/site/references.md). Vitest, not `node --test`, because the parser is TypeScript
// that plain Node can't strip.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '@acorn/node-core/server/plugins/manifest.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/plugin/apiVersion.ts'
import { manifestJsonSchema } from '@acorn/protocol/plugin/vocabulary.ts'
import { PUBLIC_EXTENSION_POINTS } from '@acorn/protocol/publicExtensionPoints.ts'

const SITE = join(import.meta.dirname, '..')
const WRITTEN = join(SITE, 'src/content/reference')
const GUIDES = join(SITE, 'src/content/docs/docs/build-plugins')
// The reference's pages are built from WRITTEN into this folder, so they're read from there instead.
const GENERATED = join(GUIDES, 'reference')

const schema = manifestJsonSchema()
const TOP_LEVEL_KEYS = Object.keys(schema.properties ?? {})
const CONTRIBUTION_KEYS = Object.keys(schema.properties?.contributions?.properties ?? {})
const contributionPage = (key: string) =>
  `contributions/${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

type Example = { page: string; mark: 'manifest' | 'manifest-invalid' | null; text: string }
type Fragment = Record<string, unknown> & { contributions?: Record<string, unknown> }

const files = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.mdx?$/.test(name))
        .map((name) => join(dir, name))
    : []

/** The plugin docs as `{ page, text }`: the reference's written halves and every guide. */
function pluginDocs(): { page: string; text: string }[] {
  return [
    ...files(WRITTEN).map((file) => ({
      page: relative(WRITTEN, file).replace(/\.mdx?$/, ''),
      text: readFileSync(file, 'utf8'),
    })),
    ...files(GUIDES)
      .filter((file) => !file.startsWith(`${GENERATED}/`))
      .map((file) => ({ page: relative(SITE, file), text: readFileSync(file, 'utf8') })),
  ]
}

/** Every fenced JSON block, with its manifest mark if it has one. */
function collectExamples(docs: { page: string; text: string }[]): Example[] {
  return docs.flatMap(({ page, text }) =>
    [...text.matchAll(/^```json([^\n]*)\n([\s\S]*?)^```/gm)].map(([, meta, body]) => ({
      page,
      mark: (meta.split(/\s+/).find((word) => word === 'manifest' || word === 'manifest-invalid') ??
        null) as Example['mark'],
      text: body.replaceAll('@API_MAJOR@', PLUGIN_API_MAJOR),
    })),
  )
}

/** A fragment as a whole manifest: the identity fields an example leaves out, then the fragment. */
const wrap = (fragment: Fragment) => ({
  id: 'acme',
  name: 'Acme',
  version: '1.0.0',
  baseline: ACORN_BASELINE,
  apiVersion: PLUGIN_API_MAJOR,
  ...fragment,
})

const parse = (text: string): Fragment | null => {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Fragment) : null
  } catch {
    return null
  }
}

/** What's wrong with each example: one that should parse and doesn't, one that should fail and parses,
 *  and an unmarked block that looks like a manifest. */
function exampleProblems(examples: Example[]): string[] {
  return examples.flatMap(({ page, mark, text }) => {
    const fragment = parse(text)
    if (!mark) {
      const looksLikeManifest = fragment && Object.keys(fragment).some((key) => TOP_LEVEL_KEYS.includes(key))
      return looksLikeManifest
        ? [`${page}: a JSON block with manifest keys isn't marked \`manifest\` or \`manifest-invalid\``]
        : []
    }
    if (!fragment) return [`${page}: a \`${mark}\` block isn't a JSON object`]
    const result = pluginManifestSchema.safeParse(wrap(fragment))
    if (mark === 'manifest' && !result.success)
      return [
        `${page}: an example doesn't parse: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      ]
    if (mark === 'manifest-invalid' && result.success) return [`${page}: an example marked manifest-invalid parses`]
    return []
  })
}

/** Keys and points with no valid example on the page that documents them. */
function coverageGaps(examples: Example[]): string[] {
  const valid = examples
    .filter((example) => example.mark === 'manifest')
    .map((example) => ({ ...example, fragment: parse(example.text)! }))
  const on = (page: string) => valid.filter((example) => example.page === page).map((example) => example.fragment)
  const manifest = on('manifest-reference')
  const extensions = on('extension-points').flatMap((fragment) =>
    Array.isArray(fragment.contributions?.extensions)
      ? (fragment.contributions.extensions as { point?: string }[])
      : [],
  )
  return [
    ...TOP_LEVEL_KEYS.filter((key) => !manifest.some((fragment) => key in fragment)).map(
      (key) => `manifest-reference has no example with \`${key}\``,
    ),
    ...CONTRIBUTION_KEYS.filter(
      (key) => !on(contributionPage(key)).some((fragment) => fragment.contributions?.[key] !== undefined),
    ).map((key) => `${contributionPage(key)} has no example with \`contributions.${key}\``),
    ...PUBLIC_EXTENSION_POINTS.filter((point) => !extensions.some((entry) => entry.point === point.id)).map(
      (point) => `extension-points has no example for \`${point.id}\``,
    ),
  ]
}

describe('the plugin docs', () => {
  const examples = collectExamples(pluginDocs())

  it('parse every manifest example with the Node parser, and fail every one marked invalid', () => {
    expect(examples.filter((example) => example.mark).length).toBeGreaterThan(60)
    expect(exampleProblems(examples)).toEqual([])
  })

  it('have an example for every manifest key, contribution key, and public extension point', () => {
    expect(coverageGaps(examples)).toEqual([])
  })
})

describe('the checks', () => {
  const page = (name: string, ...blocks: string[]) => ({ page: name, text: blocks.join('\n\n') })
  const block = (mark: string, json: object) => `\`\`\`json ${mark}\n${JSON.stringify(json)}\n\`\`\``

  it('fail an example the cross-field rules refuse, and pass one marked invalid', () => {
    const outside = {
      node: './node/index.js',
      contributions: { slots: [{ id: 'x', slot: 'topbar', data: '/v1/p/other/x' }] },
    }
    expect(exampleProblems(collectExamples([page('p', block('manifest', outside))]))).toHaveLength(1)
    expect(exampleProblems(collectExamples([page('p', block('manifest-invalid', outside))]))).toEqual([])
  })

  it('fail an unmarked block with manifest keys', () => {
    expect(exampleProblems(collectExamples([page('p', '```json\n{ "contributions": {} }\n```')]))).toHaveLength(1)
  })

  it('report a contribution key, a manifest key, and a point with no example', () => {
    const gaps = coverageGaps(collectExamples([page('manifest-reference', block('manifest', { name: 'x' }))]))
    expect(gaps).toContain('manifest-reference has no example with `migrations`')
    expect(gaps).toContain('contributions/node-stats has no example with `contributions.nodeStats`')
    expect(gaps).toContain('extension-points has no example for `core:task`')
  })
})
