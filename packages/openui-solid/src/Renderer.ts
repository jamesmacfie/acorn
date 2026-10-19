import { evaluate, isReactiveAssign, markReactive, type ElementNode } from '@openuidev/lang-core'
import {
  ErrorBoundary,
  Index,
  createComponent,
  createContext,
  createMemo,
  untrack,
  useContext,
  type JSX,
  type ParentProps,
} from 'solid-js'
import type { OpenUIRuntime } from './runtime.ts'

const RuntimeContext = createContext<OpenUIRuntime>()
const FormNameContext = createContext<string>()

/** The runtime of the program being drawn. Only components under a `Renderer` can call it. */
export function useOpenUI(): OpenUIRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('useOpenUI must be called inside a Renderer.')
  return runtime
}

/** Names the form its fields write to. A library's `Form` component wraps its children in it. */
export function FormScope(props: ParentProps<{ name: string | undefined }>): JSX.Element {
  return createComponent(FormNameContext.Provider, {
    get value() {
      return props.name
    },
    get children() {
      return props.children
    },
  })
}

export function useFormName(): string | undefined {
  return useContext(FormNameContext)
}

/** Marks a component prop as one that takes a `$` variable both ways, as an input's value does. */
export function reactive<T extends object>(schema: T): T {
  markReactive(schema)
  return schema
}

/**
 * A field's value and setter. A prop given a `$` variable reads and writes that variable;
 * otherwise the field lives in the enclosing form, or at page level, under `name`.
 */
export function createStateField(name: () => string, bound: () => unknown) {
  const runtime = useOpenUI()
  const formName = useFormName()
  const isReactive = () => isReactiveAssign(bound())
  return {
    isReactive,
    value: (): unknown => {
      const binding = bound()
      if (isReactiveAssign(binding)) return runtime.state(binding.target)
      runtime.snapshot()
      return runtime.getFieldValue(formName, name()) ?? binding
    },
    setValue(value: unknown, componentType?: string) {
      const binding = untrack(bound)
      if (!isReactiveAssign(binding)) return runtime.setFieldValue(formName, componentType, untrack(name), value)
      const next = evaluate(binding.expr, { ...runtime.evaluationContext, extraScope: { $value: value } })
      runtime.setState(binding.target, next)
    },
  }
}

function RenderNode(props: { node: ElementNode }): JSX.Element {
  const runtime = useOpenUI()
  const component = createMemo(() => runtime.library.components[props.node.typeName]?.component)
  return createMemo(() => {
    const Component = component()
    if (!Component) return null
    return untrack(() =>
      createComponent(ErrorBoundary, {
        fallback: (error: unknown) => (runtime.reportRenderError(props.node.typeName, error), null),
        get children() {
          return createComponent(Component, {
            get props() {
              return props.node.props
            },
            renderNode,
            get statementId() {
              return props.node.statementId
            },
          })
        },
      }),
    )
  }) as unknown as JSX.Element
}

/** Draws any evaluated value: a component, a list of values, or text. */
function renderNode(value: unknown): JSX.Element {
  if (value == null || typeof value === 'function') return null
  if (Array.isArray(value)) {
    return createComponent(Index<unknown[], JSX.Element>, {
      each: value,
      children: (item) => createMemo(() => renderNode(item())) as unknown as JSX.Element,
    })
  }
  if (typeof value === 'object') {
    return (value as ElementNode).type === 'element'
      ? createComponent(RenderNode, { node: value as ElementNode })
      : null
  }
  return String(value)
}

/** Draws a runtime's program. Components it draws reach the runtime through `useOpenUI`. */
export function Renderer(props: { runtime: OpenUIRuntime }): JSX.Element {
  return createComponent(RuntimeContext.Provider, {
    get value() {
      return props.runtime
    },
    get children() {
      return createMemo(() => {
        const root = props.runtime.root()
        return root ? untrack(() => createComponent(RenderNode, { node: root })) : null
      }) as unknown as JSX.Element
    },
  })
}
