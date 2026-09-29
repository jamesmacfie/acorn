import { splitProps } from 'solid-js'
import { Button, type ButtonProps } from './Button'

/** A Button that stays in. `data-pressed` is what packs style, and it has to read differently from
 *  hover in every one of them.
 *
 *  `onPressedChange`, not `onToggle`: a props member named `onToggle` collided with the DOM event of
 *  that name while ButtonProps still spread `ComponentProps<'button'>`, and the name stays for the
 *  same reason a prop is never called `ref`. */
export function ToggleButton(props: ButtonProps & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  const [own, rest] = splitProps(props, ['onPressedChange', 'onPress'])
  return <Button {...rest} onPress={() => own.onPressedChange(!props.pressed)} />
}
