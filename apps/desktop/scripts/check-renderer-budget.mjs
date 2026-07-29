import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const clientDir = resolve(import.meta.dirname, '../dist/client')
const html = await readFile(resolve(clientDir, 'index.html'), 'utf8')

const assetPaths = (pattern) => [...html.matchAll(pattern)].map((match) => match[1])
const scriptAssets = [
  ...assetPaths(/<script[^>]+src="([^"]+)"/g),
  ...assetPaths(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
]
const styleAssets = assetPaths(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)

async function totalBytes(paths) {
  const sizes = await Promise.all(paths.map(async (path) => (await stat(resolve(clientDir, path.replace(/^\//, '')))).size))
  return sizes.reduce((total, size) => total + size, 0)
}

const [scriptBytes, styleBytes] = await Promise.all([totalBytes(scriptAssets), totalBytes(styleAssets)])
const limits = {
  scripts: 1_250_000,
  styles: 200_000,
}

console.log(`[renderer-budget] startup scripts=${scriptBytes}B styles=${styleBytes}B`)
if (scriptBytes > limits.scripts || styleBytes > limits.styles) {
  throw new Error(
    `Renderer startup budget exceeded (scripts ${scriptBytes}/${limits.scripts}B, styles ${styleBytes}/${limits.styles}B). `
    + 'Keep optional plugin surfaces behind lazy contribution boundaries.',
  )
}
