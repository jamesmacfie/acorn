import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cssPath = fileURLToPath(new URL('../src/infra/styles/tokens-theme.css', import.meta.url))
const outPath = fileURLToPath(new URL('../src/infra/styles/themeCellTokens.json', import.meta.url))
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].trim(),
  tokens: Object.fromEntries([...match[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((value) => [value[1], value[2].trim()])),
}))
const find = (selector, key) => blocks.find((block) => block.selector === selector && key in block.tokens)?.tokens
const ids = ['light', 'dark', ...blocks.flatMap((block) => {
  const match = /^:root\[data-theme="([^"]+)"\]$/.exec(block.selector)
  return match && match[1] !== 'dark' ? [match[1]] : []
})]
const cellTokens = ['text', 'text-muted', 'accent', 'add-marker', 'warn', 'del-marker']
const palettes = Object.fromEntries(ids.map((id) => {
  const source = id === 'light' ? find(':root', '--text') : id === 'dark' ? find(':root', '--dark-text') : find(`:root[data-theme="${id}"]`, '--text')
  if (!source) throw new Error(`No CSS theme: ${id}`)
  return [id, Object.fromEntries(cellTokens.map((token) => {
    const value = source[`--${id === 'dark' ? 'dark-' : ''}${token}`]
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`No cell colour for ${id} ${token}`)
    return [`--${token}`, value]
  }))]
}))
const output = `${JSON.stringify(palettes, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(outPath, 'utf8') !== output) throw new Error('themeCellTokens.json is stale; run the theme-cell-tokens script')
} else writeFileSync(outPath, output)
