import { describe, expect, it, vi } from 'vitest'
import { AMEND_COMMAND, CHANGES_PANE, COMMIT_COMMAND, changesBindings, changesCommands } from './commands'

// The panel's commands as contributions: the two commit chords and the three remote palette rows. A
// binding id is a persistence key: it is what a reader's override in Settings → Shortcuts is stored
// under, so a rename here silently drops whatever they rebound
// (docs/command-palette-and-shortcuts.md § Plugin shortcuts).

const run = { commit: vi.fn(), amend: vi.fn(), remote: vi.fn(), inPane: vi.fn(() => true) }

describe('the commit commands and their chords', () => {
  it('gives every binding the id of the command it reaches', () => {
    const commands = changesCommands(run)
    const bindings = changesBindings(() => true)
    expect(bindings.map((binding) => binding.command)).toEqual([COMMIT_COMMAND, AMEND_COMMAND])
    // Every chord reaches a command that exists, and its id is the command's, because that is what a
    // rebind is stored under.
    for (const binding of bindings) expect(commands.map((command) => command.id)).toContain(binding.command)
    expect(bindings.map((binding) => binding.id)).toEqual(bindings.map((binding) => binding.command))
  })

  it('scopes both to the changes pane and nothing wider', () => {
    for (const binding of changesBindings(() => true)) {
      expect(binding.when).toBe('pane')
      expect(binding.pane).toBe(CHANGES_PANE)
    }
  })

  // A pane is wider than its editor, so pane scope alone would claim Cmd+Enter inside the diff
  // column's comment box as well.
  it('is live only while the keys are in the message field', () => {
    const focused = vi.fn(() => false)
    const bindings = changesBindings(focused)
    expect(bindings.every((binding) => binding.active() === false)).toBe(true)
    focused.mockReturnValue(true)
    expect(bindings.every((binding) => binding.active() === true)).toBe(true)
  })

  // `meta+shift+enter` is Zed's amend chord and core spent it on `core.surface.toggle-maximize`. Two
  // bindings on one chord means one of them registers nothing, so this one takes the next Enter
  // chord along.
  it('does not claim the chord core already uses for maximize', () => {
    const chords = changesBindings(() => true).map((binding) => binding.defaultChord)
    expect(chords).toEqual(['meta+enter', 'meta+alt+enter'])
    expect(chords).not.toContain('meta+shift+enter')
  })

  it('offers neither in the palette, because both act on text the reader cannot see from there', () => {
    const pair = changesCommands(run).filter((command) => command.id === COMMIT_COMMAND || command.id === AMEND_COMMAND)
    expect(pair).toHaveLength(2)
    for (const command of pair) expect('palette' in command).toBe(false)
  })

  it('runs what it was handed', () => {
    const commands = changesCommands(run)
    commands.find((command) => command.id === AMEND_COMMAND)!.run()
    expect(run.amend).toHaveBeenCalled()
    expect(run.commit).not.toHaveBeenCalled()
  })
})

// The three remote verbs are palette rows rather than chords: a fetch needs nothing typed and nothing
// selected, so a reader can reach one from a list. Force push is deliberately not among them — arming
// is its prompt, and a palette row that ran on Enter would have none.
describe('the remote palette rows', () => {
  const remoteRows = () => changesCommands(run).filter((command) => command.palette)

  it('offers fetch, pull and push, and nothing that replaces a commit', () => {
    expect(remoteRows().map((command) => command.id)).toEqual(['changes.fetch', 'changes.pull', 'changes.push'])
    expect(remoteRows().map((command) => command.title)).not.toContain('Force push')
  })

  it('runs the verb its row names', () => {
    run.remote.mockClear()
    remoteRows().find((command) => command.id === 'changes.pull')!.run()
    expect(run.remote).toHaveBeenCalledWith('pull')
  })

  // A command has no `pane` field, so the pane scope is a `when` over the host's focused pane. The
  // model can be held for a task nobody is looking at, which is exactly what this gate is for.
  it('is offered only while the changes pane has focus', () => {
    run.inPane.mockReturnValue(false)
    expect(remoteRows().every((command) => command.when!() === false)).toBe(true)
    run.inPane.mockReturnValue(true)
    expect(remoteRows().every((command) => command.when!() === true)).toBe(true)
  })

  it('is scoped to a task, because a worktree is what it acts on', () => {
    for (const command of remoteRows()) expect(command.scope).toBe('task')
  })
})

// The pane id both bindings and the remote rows' gate are written against. Named here so a rename of
// the pane contribution shows up as a test failure rather than as three dead commands.
describe('the pane id', () => {
  it('is the changes pane contribution\'s own', () => {
    expect(CHANGES_PANE).toBe('changes')
  })
})
