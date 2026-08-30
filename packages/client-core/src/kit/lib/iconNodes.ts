import rawNodes from 'lucide-static/icon-nodes.json'

// lucide-static's icon-nodes.json, typed once as a plain string-keyed map.
//
// This was an ambient `declare module 'lucide-static/icon-nodes.json'` in a .d.ts. Ambient declarations
// only apply to programs that include the declaring file, so once client-core became its own package
// the declaration was invisible to every consumer compiling client-core's source. An ordinary module
// travels with the import graph instead.
//
// `[tag, attrs]` pairs: lucide uses path, circle, rect, polyline, line, ellipse and polygon.
export const iconNodes = rawNodes as unknown as Record<string, [string, Record<string, string>][]>
