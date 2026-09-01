/** @jsxImportSource @opentui/solid */
import type { Disposable } from '@acorn/client-core/kit/lib/registry.ts'
import { extensionRegistry } from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { commandRegistry } from '@acorn/client-core/host/registries/commands/commands.ts'
import { keybindingRegistry } from '@acorn/client-core/host/registries/commands/keybindings.ts'
import { Button } from './kit/asking'
import { Text } from './kit/showing'

// Contributions nobody ships, so the cooperative extension kinds can be driven from a keyboard in a
// test (docs/tui.md § What a plugin loses here).
//
// Beside `./fixture.ts` rather than in it, because that file is the fixture *node* — routes and rows,
// no JSX — and a `component` carrier is a component. Behind flags the same way
// `ACORN_FIXTURE_SECOND_WORKSPACE` is, so the screenshots and every other suite see the shell a person
// gets.
//
// Installed from `./harness.tsx` with the other resets rather than from `App.tsx`, and this is the one
// place the design changed on contact: the composition root is module scope, so it runs once per
// worker and the second case in a file would inherit the first case's flags. Every registration here
// is disposed and re-read on each render, which is what the other fixture flags get for free by being
// read per request.

/** What the badge contribution's button was pressed with, for a test to read back. */
export const fixtureBadgePresses: string[] = []

/** A compiled contribution into github's `stack` slot on the pull-request overview.
 *
 *  Two shapes, because the keyboard contract for extension content is "as reachable as the kit nodes
 *  it draws": a contributor that draws a `Button` is a stop the reader can reach and press, and one
 *  that draws only `Text` is not a stop and does not interrupt the walk past it. */
function installBadge(shape: string): Disposable {
  return extensionRegistry.register({
    id: 'fixture:badge',
    pluginId: 'fixture',
    point: 'github:summary-badges',
    label: 'Fixture badge',
    order: 10,
    carrier: 'component',
    component: () => (shape === 'text'
      ? <Text>fixture says staging</Text>
      : <Button onPress={() => fixtureBadgePresses.push('deploy')}>Deploy fixture</Button>),
  })
}

/** A mark on the first inserted line of the fixture pull request's patch, keyed the way the shared
 *  viewer keys a row (`{ file, line, side }`, client-core/host/annotations/annotationKey.ts). */
function installDiffMark(): Disposable {
  return extensionRegistry.register({
    id: 'fixture:diff-mark',
    pluginId: 'fixture',
    point: 'github:diff-line',
    label: 'Fixture coverage',
    order: 10,
    carrier: 'items',
    fetch: async () => [],
    marks: async () => [
      { key: { file: 'src/login.ts', line: 2, side: 'new' }, text: 'uncovered', severity: 'warn' },
    ],
  })
}

/** A plugin's own chord, on a host where the command key is Ctrl.
 *
 *  A manifest chord carries a command modifier and the desktop's is `meta`, which `toKeymapKey` spells
 *  `super` and `commandLayer.ts` § `asCtrl` rewrites to `ctrl` — because a terminal emulator keeps Cmd
 *  for itself. `meta+ctrl+…` therefore arrives at the engine carrying `ctrl` twice, which its parser
 *  reads as one flag (../keys/commandLayer.ts). */
function installChord(): Disposable[] {
  return [commandRegistry.register({
    id: 'plugin.fixture.mark',
    title: 'Fixture: mark it',
    category: 'action',
    run: () => { fixtureBadgePresses.push('chord') },
  }), keybindingRegistry.register({
    id: 'plugin.fixture.mark',
    command: 'plugin.fixture.mark',
    description: 'Fixture: mark it',
    category: 'fixture',
    defaultChord: 'meta+ctrl+alt+shift+d',
  })]
}

let installed: Disposable[] = []

/** Called from the harness before each render, after the roster. Nothing registers without a flag. */
export function installFixtureExtensions(): void {
  for (const entry of installed) entry.dispose()
  installed = []
  const badge = process.env.ACORN_FIXTURE_BADGE
  if (badge) installed.push(installBadge(badge))
  if (process.env.ACORN_FIXTURE_DIFF_MARK) installed.push(installDiffMark())
  if (process.env.ACORN_FIXTURE_PLUGIN_CHORD) installed.push(...installChord())
  fixtureBadgePresses.length = 0
}
