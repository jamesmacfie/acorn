import { Show } from 'solid-js'
import type { Task } from '@acorn/plugin-api/client'
import { Button, IconButton, ToggleButton, Toolbar } from '@acorn/plugin-api/ui'
import { focusedTerminal } from './liveXterm'
import { ctrlArmed, setCtrlArmed } from './keyRow'
import TerminalSessions from './TerminalSessions'

// The phone's terminal pane: the drawer's sessions as a pane, since a phone draws no drawers, and a
// row of the keys its on-screen keyboard lacks. The row shows while a terminal has focus, which is
// while that keyboard is up, and it sits at the foot of the pane, which ends where the keyboard begins.
// Its buttons keep the focus where it is, or a press would close the keyboard.
export default function TerminalPane(props: { task: Task }) {
  return (
    <>
      <TerminalSessions task={props.task} />
      <Show when={focusedTerminal()}>
        {(terminal) => (
          <Toolbar ariaLabel="Terminal keys" size="sm">
            <Button keepsFocus size="sm" label="Esc" onPress={() => terminal().press('escape')} />
            <Button keepsFocus size="sm" label="Tab" onPress={() => terminal().press('tab')} />
            <ToggleButton
              keepsFocus
              size="sm"
              label="Ctrl"
              tip="Hold Ctrl for the next key"
              pressed={ctrlArmed()}
              onPressedChange={setCtrlArmed}
            />
            <Toolbar.Spacer />
            <IconButton keepsFocus icon="arrow-left" label="Left" onPress={() => terminal().press('left')} />
            <IconButton keepsFocus icon="arrow-up" label="Up" onPress={() => terminal().press('up')} />
            <IconButton keepsFocus icon="arrow-down" label="Down" onPress={() => terminal().press('down')} />
            <IconButton keepsFocus icon="arrow-right" label="Right" onPress={() => terminal().press('right')} />
          </Toolbar>
        )}
      </Show>
    </>
  )
}
