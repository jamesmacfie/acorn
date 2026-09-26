import type { RailProps, TopbarProps } from './chrome.ts'
import type { PaneSwitcherProps } from './paneSwitcher.ts'

type Previous = [never, 0, 1, 2, 3, 4, 5]
type DomLeak<T, Depth extends number = 5> = Depth extends 0 ? never
  : T extends Node | Event | CSSStyleDeclaration ? T
  : T extends string | number | boolean | null | undefined ? never
  : T extends (...args: infer A) => infer R ? DomLeak<A[number], Previous[Depth]> | DomLeak<R, Previous[Depth]>
  : T extends readonly (infer U)[] ? DomLeak<U, Previous[Depth]>
  : T extends object ? DomLeak<T[keyof T], Previous[Depth]>
  : never
type AssertNever<T extends never> = T

/** Any DOM or browser event in a replacement contract fails protocol's TypeScript build. */
export type ChromeContractsContainNoDom = AssertNever<DomLeak<RailProps | TopbarProps | PaneSwitcherProps>>

// @ts-expect-error The guard must catch a browser event hidden inside a host verb.
export type GuardDetectsEvent = AssertNever<DomLeak<{ choose(event: Event): void }>>
