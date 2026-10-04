import { type DataBinding, type DataPredicate, dataBindingSchema } from '../values/dataBindings'
import { resolveQueryTimeWindow } from './dataQueryTime'
import { resolveContextTime } from './contextTime'
import { type QueryBindingContext, type QueryContent, type QueryBindings } from './dataQueries'
import { validateDataValue } from '../values/dataSchemas'
import { DATA_LIMITS, MISSING, parseDataValue, readDataPointer, type DataRead, type DataValue } from '../values/dataValues'

/** Contexts contain only values the consumer has admitted (for example, predecessor outputs). */
export function resolveDataBinding(input: DataBinding, context: QueryBindingContext): DataValue {
  const value = readDataBinding(input, context)
  if (value === MISSING) throw new Error('Required binding is missing')
  return value
}

/** Keeps absence distinct for consumers with optional destinations. */
export function readDataBinding(input: DataBinding, context: QueryBindingContext): DataRead {
  const binding = dataBindingSchema.parse(input)
  const address = binding.address
  let value: DataRead
  if (address.from === 'literal') value = address.value
  else {
    if (address.from === 'context') {
      if (address.name === 'workspaceLinks') value = context.workspaceLinks ?? MISSING
      else if (address.name === 'viewer') value = context.viewer ? readDataPointer(context.viewer, address.pointer) : MISSING
      else value = context.evaluationTime === undefined ? MISSING
        : resolveContextTime(address, context.evaluationTime, context.timePolicy ?? { zone: 'UTC', weekStart: 'monday' })
    } else {
      const root = address.from === 'item' ? context.item
        : address.from === 'input' ? own(context.inputs, address.name) : own(context.steps, address.stepId)
      value = root === undefined ? MISSING : readDataPointer(root, address.pointer)
    }
  }
  if (value === MISSING) value = binding.fallback === undefined ? MISSING : binding.fallback
  if (value === MISSING) return MISSING
  if (binding.conversion === 'json-to-text') value = JSON.stringify(value)
  if (binding.conversion === 'scalar-to-text') {
    if (value !== null && typeof value === 'object') throw new Error('Scalar conversion requires a primitive')
    value = String(value)
  }
  return parseDataValue(value, DATA_LIMITS.selectionBytes)
}
function own(values: Record<string, DataValue> | undefined, key: string): DataValue | undefined {
  return values && Object.hasOwn(values, key) ? values[key] : undefined
}
export function resolveQueryParameters(content: QueryContent, bindings: QueryBindings, context: QueryBindingContext): Record<string, DataValue> {
  const values = Object.fromEntries(Object.entries(bindings).map(([key, binding]) => [key, resolveDataBinding(binding, context)]))
  validateDataValue(values, content.parameters)
  return values
}
export function resolveQueryContent(content: QueryContent, values: Record<string, DataValue>, evaluationTime = Date.now(), bindingContext: QueryBindingContext = {}) {
  validateDataValue(values, content.parameters)
  const context = { ...bindingContext, inputs: values, evaluationTime }
  const resolve = (binding: DataBinding) => {
    if (!['literal', 'input', 'context'].includes(binding.address.from)) throw new Error('Query content can bind only declared parameters or host context')
    return resolveDataBinding(binding, context)
  }
  function predicate(value: DataPredicate): DataPredicate {
    if (value.kind !== 'comparison') return { ...value, predicates: value.predicates.map(predicate) }
    if (value.left.address.from !== 'item') throw new Error('Query left operand must be a record field')
    return { ...value, ...(value.right ? { right: { address: { from: 'literal', value: resolve(value.right) } } } : {}) }
  }
  const connectionId = content.connection ? resolve(content.connection) : content.query.scope.connectionId
  if (connectionId !== undefined && (typeof connectionId !== 'string' || !connectionId)) throw new Error('Connection must be a nonempty string')
  const filter = content.query.predicate ? predicate(content.query.predicate) : undefined
  const time = content.timeWindow ? resolveQueryTimeWindow(content.timeWindow, evaluationTime) : undefined
  return {
    ...content.query,
    scope: {
      ...content.query.scope,
      ...(connectionId === undefined ? {} : { connectionId }),
      parameters: {
        ...content.query.scope.parameters,
        ...Object.fromEntries(Object.entries(content.sourceParameters).map(([key, binding]) => [key, resolve(binding)])),
      },
    },
    ...(filter || time ? { predicate: filter && time ? { kind: 'all' as const, predicates: [filter, time] } : (filter ?? time)! } : {}),
  }
}
