// Which host this build draws on. See docs/ui-design/closed-kit.md § The closed kit.
//
// Its own entrypoint, not part of ./ui, because nothing here is a component: a node-environment
// test or a build step can read it without pulling a Solid module into a place that cannot compile
// JSX.
export { HOST } from '@acorn/client-core/kit/tokens'
