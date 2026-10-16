// The ASCII acorn the app draws in its empty states, read from the app's own component so the site's
// copies can't differ from it.
import source from '@acorn/client-core/kit/components/content/Acorn.tsx?raw'

const art = source.match(/String\.raw`\n?([\s\S]*?)\n?`/)?.[1]
if (!art) throw new Error('No ASCII acorn found in Acorn.tsx. The site reads it from `String.raw` there.')

export const ACORN_ART = art
