// The kit's vocabulary as data: the role tokens a node's props accept, and which host can draw
// which node. See docs/ui-design.md § The closed kit.
//
// Its own entrypoint, not part of ./ui, because nothing here is a component: a node-environment
// test, a build step, or a node-side contribution can read the role enums without pulling a Solid
// module into a place that cannot compile JSX.

export { border, radius, ROLE_ENUMS, size, space, text, tone } from '@acorn/client-core/ui/kit/tokens.ts'
export type { Border, Radius, RoleName, Size, Space, TextRole, Tone } from '@acorn/client-core/ui/kit/tokens.ts'

// The support matrix, and the two types `Only` and `Fallback` are written against.
export { NODE_SUPPORT } from '@acorn/client-core/ui/kit/support.ts'
export type { Host, KitNode, SupportLevel } from '@acorn/client-core/ui/kit/support.ts'
