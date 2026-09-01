import rawNodes from 'lucide-static/icon-nodes.json'

// lucide-static's icon-nodes.json, typed once as a plain string-keyed map.
//
// This was an ambient `declare module 'lucide-static/icon-nodes.json'` in a .d.ts. Ambient declarations
// only apply to programs that include the declaring file, so once client-core became its own package
// the declaration was invisible to every consumer compiling client-core's source. An ordinary module
// travels with the import graph instead.
//
// No import attribute on it, and that is not an oversight: the TypeScript transform drops
// `with { type: 'json' }` before the bundler sees it, so writing one changes no output anywhere. Every
// host that draws this bundles it. The one host that does not draw it swaps the whole file out
// (apps/tui/vite.config.ts § lucide-static).
//
// `[tag, attrs]` pairs: lucide uses path, circle, rect, polyline, line, ellipse and polygon.
export const iconNodes = rawNodes as unknown as Record<string, [string, Record<string, string>][]>
