import type { ComponentProps, JSX } from 'solid-js'

export function Button(props: ComponentProps<'button'>) {
  return <button type={props.type ?? 'button'} {...props} />
}

export function TextField(props: ComponentProps<'input'>) {
  return <input {...props} />
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} />
}

export function FormField(props: { label: string; error?: string; children: JSX.Element }) {
  return (
    <label class="ui-form-field">
      <span class="settings-label">{props.label}</span>
      {props.children}
      {props.error && <span class="action-error">{props.error}</span>}
    </label>
  )
}
