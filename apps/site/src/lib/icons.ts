import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Lucide's own file for an icon, read at build, so a page ships an inline SVG and no script. */
export const lucideIcon = (name: string) => readFileSync(require.resolve(`lucide-static/icons/${name}.svg`), 'utf8')
