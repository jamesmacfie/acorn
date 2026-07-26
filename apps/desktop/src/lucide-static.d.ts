// Ambient type for lucide-static's icon-nodes.json (see core/client/ui/Icon.tsx).
//
// Deliberately NOT `resolveJsonModule`: that would make tsc infer a literal type for all 1756
// entries — every icon name a key, every path string a literal — which is pure cost for a value we
// only ever index by a runtime string. This flat type keeps the typecheck cheap; vite still bundles
// the real JSON.
//
// This file has no imports/exports on purpose. `declare module` inside a *module* file means
// augmentation of an existing module, which fails for an untyped JSON path; a script file gives a
// true ambient declaration. Keep it separate from env.d.ts, which imports and so is a module.
declare module 'lucide-static/icon-nodes.json' {
  /** `[tag, attrs]` pairs — lucide uses path, circle, rect, polyline, line, ellipse, polygon. */
  const nodes: Record<string, [string, Record<string, string>][]>
  export default nodes
}
