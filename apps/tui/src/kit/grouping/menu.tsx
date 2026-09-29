/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { isTyping } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm'
import { flatten, Line, slot } from '../cells'
import { boxBorder, litControl } from '../roles'
import { trapKeys } from '../../keys/trap'
import { bindKeys } from '../../keys/install'
import { focusedRenderable, pushScope, walkStops } from '../../keys/regions'
import { stop } from '../../keys/stops'
import { LIST, OVERLAY_OWN } from '../../keys/tiers'

/** Draw a menu below its trigger and contain focus while it is open. */
export function Menu(props: {
  /** The trigger reads focus from the surrounding menu stop. */
  trigger: (state: { open: () => boolean; toggle: () => void; focused: () => boolean }) => JSX.Element
  placement?: string
  ariaLabel: string
  open?: () => boolean
  onOpenChange?: (open: boolean) => void
  disabled?: () => boolean
  children: (context: { close: () => void }) => JSX.Element
}) {
  const [local, setLocal] = createSignal(false)
  const open = () => props.open?.() ?? local()
  const set = (next: boolean) => {
    setLocal(next)
    props.onOpenChange?.(next)
  }
  const control = stop({
    onPress: () => set(!open()),
    disabled: () => props.disabled?.() ?? false,
    // Enter here opens the list rather than doing something, and the footer says so.
    opens: true,
  })
  return (
    // An open menu takes a full row so its list does not inherit the trigger's narrow width.
    <box flexDirection="column" {...(open() ? { flexBasis: '100%' as const } : {})}>
      {/* The trigger's characters are the caller's; the box around them is the stop. */}
      <box flexDirection="row" flexShrink={0} ref={control.ref}>
        {props.trigger({ open, toggle: () => set(!open()), focused: control.focused })}
      </box>
      <Show when={open()}>
        {/* Mount the trap with the list so closing it releases the keys. */}
        <MenuList close={() => set(false)}>{props.children({ close: () => set(false) })}</MenuList>
      </Show>
    </box>
  )
}

/** Own the focus scope and keys for an open menu. */
function MenuList(props: { close: () => void; children: JSX.Element }) {
  trapKeys(() => props.close())
  return (
    <box
      flexDirection="column"
      {...boxBorder('surface')}
      paddingLeft={1}
      paddingRight={1}
      ref={(element: Renderable) => {
        // Closing the list disposes this scope and restores the trigger's keys.
        onCleanup(pushScope(element))
        // Menus contain arbitrary child trees, so walk their stops within this list box.
        const walk = (delta: 1 | -1) => () => walkStops(focusedRenderable(), delta, { within: element })
        bindKeys(element, [
          { key: 'j', cmd: walk(1) },
          { key: 'k', cmd: walk(-1) },
          { key: 'down', cmd: walk(1) },
          { key: 'up', cmd: walk(-1) },
        ], LIST)
        // While a filter owns typing, arrows still walk menu rows. Bind only during that state;
        // a runtime matcher would disable the key engine's active-binding cache.
        createEffect(() => {
          focusedRenderable()
          if (!isTyping()) return
          bindKeys(element, [
            { key: 'down', cmd: walk(1) },
            { key: 'up', cmd: walk(-1) },
          ], OVERLAY_OWN)
        })
      }}
    >
      {props.children}
    </box>
  )
}

/** A menu stop. A destructive item stays open while its confirmation is armed. */
Menu.Item = (props: {
  context: { close: () => void }
  onSelect: () => void
  disabled?: boolean
  closeOnSelect?: boolean
  confirm?: string
  tone?: 'neutral' | 'danger'
  leading?: JSX.Element
  trailing?: JSX.Element
  title?: string
  children: JSX.Element
}) => {
  const armed = createArmedConfirm()
  const isArmed = () => !!props.confirm && armed.armed() !== null
  const control = stop({
    onPress: () => {
      // Arming leaves the list open, or the prompt would close under the press that raised it.
      if (props.confirm && !armed.request('confirm')) return
      props.onSelect()
      if (props.closeOnSelect !== false) props.context.close()
    },
    disabled: () => !!props.disabled,
  })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line tone="accent">{control.focused() ? '›' : ' '}</Line>
      {slot(props.leading)}
      <Line {...litControl({
        focused: control.focused(),
        strong: isArmed(),
        disabled: props.disabled,
        tone: isArmed() || props.tone === 'danger' ? 'danger' : undefined,
      })}>
        {isArmed() ? props.confirm ?? '' : flatten(props.children)}
      </Line>
      <box flexGrow={1} />
      {slot(props.trailing)}
    </box>
  )
}
