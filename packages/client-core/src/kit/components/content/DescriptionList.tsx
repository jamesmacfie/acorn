import type { JSX } from 'solid-js'

/* DescriptionList: label/value pairs. `columns` puts the label left and the value right; `facts`
   is auto-fit tiles with the label above the value. A real <dl>/<dt>/<dd> announces the pairing.

   It takes children rather than an `items` array, which keeps it out of formatting values. A site
   that needs sorting or filtering wants a table instead. */
export function DescriptionList(props: {
  layout?: 'columns' | 'facts'
  size?: 'sm' | 'md'
  children: JSX.Element
}) {
  return (
    <dl class="ui-dl" data-layout={props.layout ?? 'columns'} data-size={props.size ?? 'md'}>
      {props.children}
    </dl>
  )
}

DescriptionList.Item = (props: { label: JSX.Element; mono?: boolean; wide?: boolean; children: JSX.Element }) => (
  // The wrapping div is what makes grid placement work for the `facts` layout. `<dl>` permits it.
  <div class="ui-dl-item" data-wide={props.wide ? '' : undefined}>
    <dt class="ui-dl-label">{props.label}</dt>
    <dd class="ui-dl-value" data-mono={props.mono ? '' : undefined}>{props.children}</dd>
  </div>
)
