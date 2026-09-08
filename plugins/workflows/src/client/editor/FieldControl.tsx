import { createResource, Show } from 'solid-js'
import { activeTaskId } from '@acorn/plugin-api/client'
import { Checkbox, Field, Input, Select, Textarea } from '@acorn/plugin-api/ui'
import type { StepField } from '../../shared/workflowContracts'
import { workflowApi } from '../workflowsClient'

// One field of a step kind's `describe`, as the matching kit control
// (docs/workflows.md § Contributed step kinds).
//
// The host draws it, which is the whole point of describing a form as data: a plugin contributes a
// step kind and its inputs appear on both hosts with no component of its own. `prompt` is not here —
// it is a textarea with reference chips and lives in ./PromptField.tsx.

/** A select whose choices come from the contributing plugin's own route.
 *
 *  Two guards, and both matter. The route must sit inside that plugin's namespace, because a
 *  description is data a node sent and a route outside it would let one plugin read another's; and a
 *  placeholder the editor cannot fill means no fetch at all, because half a path is not a path. */
export function fieldOptionsRoute(
  route: string,
  pluginId: string | null,
  context: { projectId?: string; taskId?: string },
): string | undefined {
  const namespace = pluginId ? `/v2/p/${pluginId}/` : '/v2/p/workflows/'
  if (!route.startsWith(namespace)) return undefined
  const filled = route
    .replace('{projectId}', context.projectId ?? '')
    .replace('{taskId}', context.taskId ?? '')
  return /\{|\/\//.test(filled) || filled.endsWith('/') ? undefined : filled
}

function RouteSelect(props: {
  field: StepField
  pluginId: string | null
  projectId: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const route = () => fieldOptionsRoute(props.field.optionsRoute ?? '', props.pluginId, {
    projectId: props.projectId,
    taskId: activeTaskId() ?? undefined,
  })
  const [options] = createResource(route, async (path) =>
    workflowApi.fieldOptions(path).then((answer) => answer.options).catch(() => []))
  return (
    <Show
      when={route()}
      fallback={(
        <Input
          size="sm"
          value={props.value}
          disabled={props.disabled}
          label={props.field.label}
          placeholder="Open a task to list these"
          onInput={props.onChange}
        />
      )}
    >
      <Select
        size="sm"
        label={props.field.label}
        disabled={props.disabled}
        value={props.value}
        options={[
          { value: '', label: options.loading ? 'Loading…' : 'Not set' },
          ...(options() ?? []).map((option) => ({ value: option.value, label: option.label, title: option.description })),
        ]}
        onChange={props.onChange}
      />
    </Show>
  )
}

export default function FieldControl(props: {
  field: StepField
  /** Which plugin contributed the kind, for the namespace check on `optionsRoute`. */
  pluginId: string | null
  projectId: string
  value: unknown
  disabled?: boolean
  /** Static choices the editor knows and the description does not: the catalog's policies, the
   *  harness profiles, the definition's own fan-out steps. */
  options?: readonly { value: string; label: string; description?: string }[]
  onChange: (value: unknown) => void
}) {
  const text = () => (props.value == null ? '' : String(props.value))
  const hint = () => (props.field.required ? [props.field.hint, 'Required.'].filter(Boolean).join(' ') : props.field.hint)
  const missing = () => props.field.required && !text().trim()

  // A checkbox carries its own label, so it is not wrapped in a labelled Field: two captions for one
  // control is what `Field group` exists to avoid.
  return (
    <Show
      when={props.field.type !== 'boolean'}
      fallback={(
        <Field hint={hint()} group>
          <Checkbox
            checked={props.value === true}
            disabled={props.disabled}
            label={props.field.label}
            onChange={(checked) => props.onChange(checked)}
          />
        </Field>
      )}
    >
    <Field label={props.field.label} hint={hint()} error={missing() ? 'This one has to be filled in.' : undefined} group>
      <Show when={props.field.type === 'number'}>
        <Input
          size="sm"
          type="number"
          width="narrow"
          label={props.field.label}
          disabled={props.disabled}
          invalid={missing()}
          min={props.field.min}
          max={props.field.max}
          value={text()}
          placeholder={props.field.placeholder}
          onInput={(value) => props.onChange(value === '' ? undefined : Number(value))}
        />
      </Show>
      <Show when={props.field.type === 'text'}>
        <Input
          size="sm"
          label={props.field.label}
          disabled={props.disabled}
          invalid={missing()}
          value={text()}
          assist={false}
          placeholder={props.field.placeholder}
          onInput={props.onChange}
        />
      </Show>
      <Show when={props.field.type === 'textarea'}>
        <Textarea
          size="sm"
          rows={4}
          mono
          label={props.field.label}
          disabled={props.disabled}
          invalid={missing()}
          value={text()}
          assist={false}
          placeholder={props.field.placeholder}
          onInput={props.onChange}
        />
      </Show>
      {/* A select the editor can fill draws a list. One whose route this host cannot reach, or whose
          choices nothing knows, falls back to typing the value: a definition written by hand can name
          something this node has never heard of, and the editor must not lose it. */}
      <Show when={props.field.type === 'select'}>
        <Show
          when={props.field.optionsRoute || (props.options ?? props.field.options ?? []).length}
          fallback={(
            <Input
              size="sm"
              label={props.field.label}
              disabled={props.disabled}
              invalid={missing()}
              value={text()}
              assist={false}
              placeholder={props.field.placeholder}
              onInput={props.onChange}
            />
          )}
        >
        <Show
          when={!props.field.optionsRoute || props.options}
          fallback={(
            <RouteSelect
              field={props.field}
              pluginId={props.pluginId}
              projectId={props.projectId}
              value={text()}
              disabled={props.disabled}
              onChange={props.onChange}
            />
          )}
        >
          <Select
            size="sm"
            label={props.field.label}
            disabled={props.disabled}
            invalid={missing()}
            value={text()}
            options={[
              { value: '', label: 'Not set' },
              ...(props.options ?? props.field.options ?? []).map((option) => ({
                value: option.value,
                label: option.label,
                title: option.description,
              })),
            ]}
            onChange={props.onChange}
          />
        </Show>
        </Show>
      </Show>
    </Field>
    </Show>
  )
}
