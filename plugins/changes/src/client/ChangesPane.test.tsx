import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import type { Task } from '@acorn/plugin-api/client'
import { emptyLocalStatus } from '../shared/api'
import { ChangesFooter, ChangesHeader, ChangesList } from './ChangesPane'
import type { ChangesModel } from './changesModel'
import {
  commitMode, DEFAULT_CHANGE_VIEW, groupChanges, groupSections, isFolderKey, stageableRows,
  stagedState, viewNodes, type ChangeView,
} from './model'

// The list column in jsdom, which is the tier that can answer what a click on a checkbox does. The
// node-environment suite next door has the grouping and the parsing; this one has the control.
//
// The model is a stand-in rather than the real one: `createChangesModel` fetches over HTTP, reads the
// projects query and subscribes to the task poll, and none of that is what a checkbox is about. What
// is real is the pane, the kit and the pure functions the pane derives its checkbox states from.

// The footer's `changes:push-actions` slot reads the reader's arbitration preference, which is the one
// thing here that needs a shell behind it. Nobody fills the point in this file, so the slot draws
// nothing; ./RemoteBar.test.tsx is where its own states are.
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))

const change = (path: string, staged: boolean, status: LocalChange['status'] = 'modified'): LocalChange => ({
  path,
  status,
  staged,
  additions: null,
  deletions: null,
})

const stage = vi.fn()
const unstage = vi.fn()
const setView = vi.fn()
const commitAction = vi.fn(async () => {})
const toggleAmend = vi.fn()
const setNoVerify = vi.fn()

/** What the footer reads beyond the list's own state. Defaults are "a message typed, nothing set". */
type Commit = { draft: string; amend: boolean; signoff: boolean; noVerify: boolean }

const model = (changes: LocalChange[], chosen: Partial<ChangeView> = {}, commit: Partial<Commit> = {}): ChangesModel => {
  const groups = () => groupChanges(changes)
  const view = () => ({ ...DEFAULT_CHANGE_VIEW, ...chosen })
  const editor: Commit = { draft: '', amend: false, signoff: false, noVerify: false, ...commit }
  // The one piece of state the list really holds, so the twist on a folder row has something to move.
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set())
  return {
    // The two ids the footer's slot hands a contributor.
    task: { id: 't1', projectId: 'p1' },
    isGit: () => true,
    groups,
    view,
    setView,
    sections: () => groupSections(groups(), view()).map((section) => ({ ...section, nodes: viewNodes(section.rows, view()) })),
    closedFolders: closed,
    expanded: (key: string) => !closed().has(key),
    foldFolder: (key: string, expand: boolean) => {
      if (!isFolderKey(key)) return false
      const next = new Set(closed())
      if (expand) next.delete(key)
      else next.add(key)
      setClosed(next)
      return true
    },
    totals: () => ({ additions: 0, deletions: 0 }),
    headerStage: () => (stagedState(stageableRows(groups())) === 'all' ? 'unstage' : 'stage'),
    isSelected: () => false,
    select: () => {},
    draft: () => editor.draft,
    setDraft: () => {},
    commitMode: () => commitMode(groups()),
    committing: () => false,
    amend: () => editor.amend,
    toggleAmend,
    signoff: () => editor.signoff,
    setSignoff: () => {},
    noVerify: () => editor.noVerify,
    setNoVerify,
    setEditorFocused: () => {},
    canCommit: () => !!editor.draft.trim() && (editor.amend || commitMode(groups()) !== 'none'),
    commit: commitAction,
    // What the footer's branch bar reads. A clean status with no upstream, so the bar draws Publish
    // and gets out of the way of what this file is about; ./RemoteBar.test.tsx is where the bar's own
    // states are.
    status: () => emptyLocalStatus(),
    remoteBusy: () => false,
    remote: () => {},
    // No model provider connected, so the footer draws no wand. ./GenerateButton.test.tsx is where
    // that control's own states are.
    modelConnections: () => [],
    modelPick: () => null,
    setModelPick: () => {},
    generating: () => false,
    generate: () => {},
    actionError: () => '',
    stage,
    unstage,
    discard: () => {},
    sendRef: () => {},
    project: () => undefined,
    unsent: () => [],
    sendMsg: () => '',
    agentIdle: () => false,
  } as unknown as ChangesModel
}

let host: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  host.remove()
  for (const surface of document.querySelectorAll('.ui-menu')) surface.remove()
  for (const stub of [stage, unstage, setView, commitAction, toggleAmend, setNoVerify]) stub.mockClear()
  // The folds persist their open state, and a test that collapsed one must not tell the next one.
  localStorage.clear()
})

// Built before the render, not inside it. A JSX prop is a getter, so `model={model(changes)}` would
// mint a new one on every read and the folded-folder signal inside it would never survive a click.
// The host builds it once per task for the same reason (client-core registries/paneModels.ts).
const draw = (changes: LocalChange[], chosen: Partial<ChangeView> = {}) => {
  const built = model(changes, chosen)
  disposers.push(render(() => <ChangesList task={{ id: 't1' } as unknown as Task} model={built} />, host))
  return host
}

const drawFooter = (changes: LocalChange[], commit: Partial<Commit> = {}) => {
  const built = model(changes, {}, commit)
  disposers.push(render(() => <ChangesFooter task={{ id: 't1' } as unknown as Task} model={built} />, host))
  return host
}

const drawHeader = (changes: LocalChange[], chosen: Partial<ChangeView> = {}) => {
  const built = model(changes, chosen)
  disposers.push(render(() => <ChangesHeader task={{ id: 't1' } as unknown as Task} model={built} />, host))
  return host
}

/** One group's `<details>`, by the label in its summary. */
const group = (title: string): HTMLDetailsElement => {
  const found = [...host.querySelectorAll('details')].find((fold) => fold.querySelector('.ui-section-header-label')?.textContent === title)
  if (!found) throw new Error(`no ${title} group; groups are ${[...host.querySelectorAll('.ui-section-header-label')].map((l) => l.textContent).join(', ')}`)
  return found as HTMLDetailsElement
}

const rowChecks = (title: string) => [...group(title).querySelectorAll<HTMLInputElement>('.ui-row-trailing .ui-check-box')]
const groupCheck = (title: string) => group(title).querySelector<HTMLInputElement>('summary .ui-check-box')

describe('staging from the list', () => {
  it('stages one file from its own row', () => {
    draw([change('src/a.ts', false), change('src/b.ts', false)])
    const checks = rowChecks('Tracked')
    expect(checks).toHaveLength(2)
    expect(checks[0].checked).toBe(false)

    checks[0].click()
    expect(stage).toHaveBeenCalledWith(['src/a.ts'])
  })

  it('unstages from a checked row and stages the rest from a half-staged one', () => {
    draw([change('src/staged.ts', true), change('src/both.ts', true), change('src/both.ts', false)])
    const checks = rowChecks('Tracked')
    // Alphabetical: both.ts, then staged.ts.
    expect(checks.map((box) => [box.checked, box.indeterminate])).toEqual([[false, true], [true, false]])

    checks[0].click()
    expect(stage).toHaveBeenCalledWith(['src/both.ts'])
    checks[1].click()
    expect(unstage).toHaveBeenCalledWith(['src/staged.ts'])
  })

  it('stages only the unstaged paths from a group whose checkbox is indeterminate', () => {
    draw([change('src/done.ts', true), change('src/a.ts', false), change('src/b.ts', false)])
    const box = groupCheck('Tracked')!
    expect(box.checked).toBe(false)
    expect(box.indeterminate).toBe(true)

    box.click()
    expect(stage).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])
  })

  it('unstages the whole group once every row in it is staged', () => {
    draw([change('src/a.ts', true), change('src/b.ts', true)])
    const box = groupCheck('Tracked')!
    expect(box.checked).toBe(true)
    expect(box.indeterminate).toBe(false)

    box.click()
    expect(unstage).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])
  })

  it('groups untracked files apart from tracked edits, with their own checkbox', () => {
    draw([change('src/a.ts', false), change('notes.md', false, 'untracked')])
    expect(rowChecks('Tracked')).toHaveLength(1)
    expect(rowChecks('Untracked')).toHaveLength(1)

    groupCheck('Untracked')!.click()
    expect(stage).toHaveBeenCalledWith(['notes.md'])
  })
})

describe('a conflicted file', () => {
  it('gets its own group, with no checkbox on the row or the group', () => {
    draw([change('src/clash.ts', false, 'conflicted'), change('src/a.ts', false)])
    expect(rowChecks('Conflicts')).toEqual([])
    expect(groupCheck('Conflicts')).toBeNull()
    // The badge is git's own letter for an unmerged file, so the row does not read as a modification.
    expect(group('Conflicts').querySelector('.ui-row-leading')?.textContent).toBe('U')
    // And the ordinary row beside it still has one.
    expect(rowChecks('Tracked')).toHaveLength(1)
  })
})

describe('an empty tree', () => {
  it('draws no groups at all', () => {
    draw([])
    expect(host.querySelectorAll('details')).toHaveLength(0)
    expect(host.textContent).toContain('Working tree clean')
  })
})

/** The folder rows of a group. `TreeRow` is the only row drawn as a tree; the files under it are the
 *  same `Row` the flat list uses, which is the whole point of phase 0's `depth`. */
const folderRows = (title: string) => [...group(title).querySelectorAll<HTMLElement>('.ui-row[data-variant="tree"]')]
/** What each row of a group says, badge and counts left out. */
const rowLabels = (title: string) =>
  [...group(title).querySelectorAll<HTMLElement>('.ui-row')].map((row) => row.querySelector('.ui-row-body')?.textContent)

describe('tree view', () => {
  it('nests the files under one row for a collapsed folder chain', () => {
    draw([change('a/b/one.ts', false), change('a/b/two.ts', false), change('top.ts', false)], { mode: 'tree' })
    expect(folderRows('Tracked').map((row) => row.textContent)).toEqual(['a/b'])
    expect(rowLabels('Tracked')).toEqual(['a/b', 'one.ts', 'two.ts', 'top.ts'])
    // The folder says where the files are, so the rows under it do not repeat the directory.
    expect(rowLabels('Tracked').some((label) => label?.includes('a/b/'))).toBe(false)
  })

  it('stages only the unstaged descendants from an indeterminate folder', () => {
    draw([change('a/b/one.ts', true), change('a/b/two.ts', false)], { mode: 'tree' })
    const box = folderRows('Tracked')[0].querySelector<HTMLInputElement>('.ui-check-box')!
    expect(box.checked).toBe(false)
    expect(box.indeterminate).toBe(true)

    box.click()
    expect(stage).toHaveBeenCalledWith(['a/b/two.ts'])
  })

  it('unstages the subtree from a folder whose files are all staged', () => {
    draw([change('a/one.ts', true), change('a/deep/two.ts', true)], { mode: 'tree' })
    const box = folderRows('Tracked')[0].querySelector<HTMLInputElement>('.ui-check-box')!
    expect(box.checked).toBe(true)

    box.click()
    expect(unstage).toHaveBeenCalledWith(['a/deep/two.ts', 'a/one.ts'])
  })

  it('hides what is under a folder the reader closes', () => {
    draw([change('a/b/one.ts', false), change('top.ts', false)], { mode: 'tree' })
    const twist = folderRows('Tracked')[0].querySelector<HTMLElement>('.ui-row-twist[role="button"]')!
    expect(twist.getAttribute('aria-expanded')).toBe('true')

    twist.click()
    expect(rowLabels('Tracked')).toEqual(['a/b', 'top.ts'])
  })

  it('gives a conflicted folder no checkbox, because the rows under it have none', () => {
    draw([change('a/clash.ts', false, 'conflicted')], { mode: 'tree' })
    expect(folderRows('Conflicts')[0].querySelector('.ui-check-box')).toBeNull()
  })
})

describe('the grouping', () => {
  it('splits the list by staging area when asked, conflicts still on their own', () => {
    draw([change('a.ts', true), change('b.ts', false), change('clash.ts', false, 'conflicted')], { groupBy: 'staged' })
    expect([...host.querySelectorAll('.ui-section-header-label')].map((label) => label.textContent))
      .toEqual(['Conflicts', 'Staged', 'Unstaged'])
    expect(rowLabels('Staged')).toEqual(['a.ts'])
    expect(rowLabels('Unstaged')).toEqual(['b.ts'])
  })

  it('draws one run with no fold when asked for no groups', () => {
    draw([change('a.ts', true), change('n.md', false, 'untracked')], { groupBy: 'none' })
    expect(host.querySelectorAll('details')).toHaveLength(0)
    expect([...host.querySelectorAll<HTMLElement>('.ui-row-body')].map((body) => body.textContent)).toEqual(['a.ts', 'n.md'])
  })
})

/** The view menu's items, which the kit portals to the document rather than into the header. The
 *  chosen one is the one whose mark is titled, since `Menu.Item` has no checked state to read. */
const openViewMenu = () => {
  host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click()
  return [...document.querySelectorAll<HTMLElement>('.ui-menu-item')].map((item) => ({
    label: item.querySelector('.ui-menu-label')?.textContent ?? '',
    chosen: !!item.querySelector('.ui-menu-leading [role="img"]'),
    press: () => item.click(),
  }))
}

describe('the view menu', () => {
  it('offers the sort in list view', () => {
    drawHeader([change('src/a.ts', false)])
    expect(openViewMenu().map((item) => item.label)).toEqual([
      'List', 'Tree', 'Sort by path', 'Sort by name', 'No groups', 'Group tracked and untracked', 'Group staged and unstaged',
    ])
  })

  it('leaves the sort out in tree view, where the folders are the order', () => {
    drawHeader([change('src/a.ts', false)], { mode: 'tree' })
    expect(openViewMenu().map((item) => item.label)).toEqual([
      'List', 'Tree', 'No groups', 'Group tracked and untracked', 'Group staged and unstaged',
    ])
  })

  it('marks the chosen item in each run and writes one choice at a time', () => {
    drawHeader([change('src/a.ts', false)], { mode: 'tree', groupBy: 'staged' })
    const items = openViewMenu()
    expect(items.filter((item) => item.chosen).map((item) => item.label)).toEqual(['Tree', 'Group staged and unstaged'])

    items.find((item) => item.label === 'List')!.press()
    expect(setView).toHaveBeenCalledWith({ mode: 'list' })
  })
})

/** The footer's buttons, by the text on them. The commit button is the one whose label moves. */
const footerButton = (label: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === label)
  if (!found) throw new Error(`no ${label} button; buttons are ${[...host.querySelectorAll('button')].map((b) => b.textContent?.trim()).join(' | ')}`)
  return found
}

const commitOptions = () => {
  const trigger = [...host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')]
    .find((button) => button.getAttribute('aria-label') === 'Commit options')!
  trigger.click()
  return [...document.querySelectorAll<HTMLElement>('.ui-menu-item')].map((item) => ({
    label: item.querySelector('.ui-menu-label')?.textContent ?? '',
    on: !!item.querySelector('.ui-menu-leading [role="img"]'),
    press: () => item.click(),
  }))
}

describe('the commit editor', () => {
  it('is there on a clean tree, where the one-line field used to appear only once something was staged', () => {
    drawFooter([])
    expect(host.querySelector('textarea')).not.toBeNull()
    // Nothing a commit could pick up, and no message either.
    expect(footerButton('Commit').disabled).toBe(true)
  })

  it('reads Commit with something staged and Commit tracked without', () => {
    drawFooter([change('src/a.ts', true)], { draft: 'feat: one' })
    expect(footerButton('Commit').disabled).toBe(false)

    host.replaceChildren()
    for (const dispose of disposers.splice(0)) dispose()
    drawFooter([change('src/a.ts', false)], { draft: 'feat: one' })
    expect(footerButton('Commit tracked').disabled).toBe(false)
  })

  it('reads Amend once amend is on, whatever is staged', () => {
    drawFooter([change('src/a.ts', false)], { draft: 'feat: one', amend: true })
    expect(footerButton('Amend').disabled).toBe(false)
  })

  it('stays off until something is typed', () => {
    drawFooter([change('src/a.ts', true)])
    expect(footerButton('Commit').disabled).toBe(true)
  })

  it('commits when pressed', () => {
    drawFooter([change('src/a.ts', true)], { draft: 'feat: one' })
    footerButton('Commit').click()
    expect(commitAction).toHaveBeenCalled()
  })

  // The button's hint is the command it is about to run, which is the one place a reader can see what
  // the changed label actually does.
  it('names the git command it will run, flags and all', () => {
    drawFooter([change('src/a.ts', false)], { draft: 'feat: one', signoff: true, noVerify: true })
    expect(footerButton('Commit tracked').getAttribute('data-tip-sub')).toBe('git commit -a --signoff --no-verify -m')
  })
})

describe('the commit options menu', () => {
  it('offers the three switches, each saying whether it is on', () => {
    drawFooter([change('src/a.ts', true)], { draft: 'feat: one', signoff: true })
    const items = commitOptions()
    expect(items.map((item) => item.label)).toEqual(['Amend the last commit', 'Add a sign-off line', 'Skip git hooks'])
    expect(items.filter((item) => item.on).map((item) => item.label)).toEqual(['Add a sign-off line'])
  })

  it('turns one on without closing, so a reader can set two', () => {
    drawFooter([change('src/a.ts', true)], { draft: 'feat: one' })
    const items = commitOptions()
    items.find((item) => item.label === 'Skip git hooks')!.press()
    expect(setNoVerify).toHaveBeenCalledWith(true)
    expect(document.querySelectorAll('.ui-menu-item').length).toBeGreaterThan(0)
  })

  it('sends amend through the model, which is what fills an empty message from HEAD', () => {
    drawFooter([change('src/a.ts', true)])
    commitOptions().find((item) => item.label === 'Amend the last commit')!.press()
    expect(toggleAmend).toHaveBeenCalled()
  })
})

describe('the expanded editor', () => {
  it('opens a modal over the same draft and commits from it', () => {
    drawFooter([change('src/a.ts', true)], { draft: 'feat: a long one' })
    host.querySelector<HTMLButtonElement>('button[aria-label="Expand the message"]')!.click()

    // On the document, not in `host`: the modal portals its backdrop to the body.
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('.overlay-title')?.textContent).toBe('Commit message')
    const field = dialog.querySelector<HTMLTextAreaElement>('textarea')!
    expect(field.value).toBe('feat: a long one')

    const button = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Commit')!
    button.click()
    expect(commitAction).toHaveBeenCalled()
  })
})
