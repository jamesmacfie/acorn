// Published declaration for `acorn-plugin-sdk/remote`, hand-written and copied verbatim to
// dist/remote.d.ts, for the same reason ../public.ts is: the built file is a bundle and carries no
// types of its own. See docs/plugins.md § What is published, and what acorn promises about it.
//
// Only two things here are yours to call. Everything else is what the Solid JSX preset compiles
// against, and its names are Solid's; they are exported because the preset imports them by name, not
// because you write them.
import type { JSX } from 'solid-js'
import type { AcornBridge, TreeRender } from 'acorn-plugin-sdk'

/**
 * Wrap a Solid component as a tree renderer.
 *
 * Point the JSX preset at this module and your components compile into acorn's tree instead of into
 * a document:
 *
 * ```ts
 * solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })
 * ```
 *
 * The props acorn mounted with arrive as a store, so a redraw reconciles rather than tearing the tree
 * down: a card whose data gains a line re-renders that line.
 */
export declare function solidTree<P extends Record<string, unknown>>(
  component: (props: P & { bridge: AcornBridge }) => JSX.Element,
): TreeRender

// The universal-renderer surface. Solid's compiler emits calls to these; you do not.
export declare const render: (code: () => unknown, node: unknown) => () => void
export declare const effect: (fn: (prev?: unknown) => unknown, init?: unknown) => void
export declare const memo: (fn: () => unknown, equal?: boolean) => () => unknown
export declare const createComponent: (component: unknown, props: unknown) => unknown
export declare const createElement: (type: string) => unknown
export declare const createTextNode: (value: string) => unknown
export declare const insertNode: (parent: unknown, node: unknown, anchor?: unknown) => void
export declare const insert: (parent: unknown, accessor: unknown, marker?: unknown, initial?: unknown) => unknown
export declare const spread: (node: unknown, accessor: unknown, skipChildren?: boolean) => void
export declare const setProp: (node: unknown, name: string, value: unknown, prev?: unknown) => unknown
export declare const mergeProps: (...sources: unknown[]) => unknown
export declare const use: (fn: unknown, element: unknown, arg: unknown) => unknown
