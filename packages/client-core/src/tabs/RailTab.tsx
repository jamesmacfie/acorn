import { splitProps, type ComponentProps } from 'solid-js'
import { cx } from '../ui/cx'
import './tabrail.css'

/* The square icon tab both rails are made of: the workspace rail down the left and the task pane
   switcher down the right. Deliberately not a Button. A rail tab hovers by changing its icon and
   background only, while `.ui-btn:hover` also moves `border-color`, which lit up the tab's own
   dividers on the right-hand rail and made the two sides look unrelated. */
export function RailTab(props: ComponentProps<'button'>) {
  const [own, rest] = splitProps(props, ['class', 'children'])
  return (
    <button {...rest} type={props.type ?? 'button'} class={cx('tabrail-tab', own.class)}>
      {own.children}
    </button>
  )
}
