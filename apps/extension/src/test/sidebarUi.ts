import { settle } from './fakeBrowser'

// Steps through the panel's levels the way a person does, for the sidebar tests.

// A button by its words or, for an icon button, its accessible name.
export const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === name || element.getAttribute('aria-label') === name,
  )

export const selected = (root: ParentNode, name: string) =>
  root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value

export async function pick(root: ParentNode, name: string, value: string) {
  const select = root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await settle(20)
}

const header = (root: ParentNode) => root.querySelector('header')!

async function click(element: HTMLElement | undefined, what: string) {
  if (!element) throw new Error(`No ${what} on screen.`)
  element.click()
  await settle(20)
}

// Up one level: from a conversation to its task, or from a task or Settings to Home.
export const back = (root: ParentNode) => click(button(header(root), 'Back'), 'Back button')

// Home, from any level.
export async function goHome(root: ParentNode) {
  while (button(header(root), 'Back')) await back(root)
}

// Settings, from the gear on Home.
export async function openSettings(root: ParentNode) {
  await goHome(root)
  await click(button(header(root), 'Settings'), 'Settings button')
}

// Picks a tab under the open task: Agents, Runs, or a plugin's panel.
export const tab = (root: ParentNode, label: string) =>
  click(button(root.querySelector('[role="tablist"][aria-label="Task"]') ?? root, label), `${label} tab`)

// The tabs under the open task, by label.
export const taskTabs = (root: ParentNode) =>
  [...root.querySelectorAll('[role="tablist"][aria-label="Task"] [role="tab"]')].map((tab) => tab.textContent)

// Switches Nodes from Settings, then goes back Home.
export async function useNode(root: ParentNode, label: string) {
  await openSettings(root)
  const row = [...root.querySelectorAll('[aria-label="Nodes"] li')].find(
    (item) => item.querySelector('strong')?.textContent === label,
  )
  await click(row && button(row, 'Use'), `Use button for ${label}`)
  await back(root)
}

// Picks a row in the kit picker whose trigger is named `name`. Its list draws in a portal on the body.
export async function pickFrom(root: ParentNode, name: string, label: string) {
  await click(button(root, name), `${name} picker`)
  const rows = [...document.querySelectorAll<HTMLButtonElement>('.repo-picker-popover .repo-picker-name')]
  await click(
    rows.find((row) => row.querySelector('span')?.textContent === label),
    `${label} in the ${name} picker`,
  )
}

// What the kit picker named `name` shows as its value.
export const chosen = (root: ParentNode, name: string) =>
  button(root, name)?.querySelector('.repo-picker-label')?.textContent

// Home's task rows, each the kit's row with its title.
export const taskRows = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLElement>('[aria-label="Home"] [aria-label="Tasks"] .ui-row'),
]

export const taskRow = (root: ParentNode, title: string) =>
  taskRows(root).find((row) => row.querySelector('.row-title')?.textContent === title)

// Opens a task from Home's task list.
export async function openTask(root: ParentNode, title: string) {
  await goHome(root)
  await click(taskRow(root, title), `task row ${title}`)
}

// Opens a task from the project's list on This page.
export async function openSiteTask(root: ParentNode, title: string) {
  const rows = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="This page"] [aria-label="Tasks"] button')]
  await click(
    rows.find((row) => row.querySelector('strong')?.textContent === title),
    `This page task row ${title}`,
  )
}

// Opens a conversation from the open task's Agents tab, going back to it first when one is open.
export async function openChat(root: ParentNode, title: string) {
  if (root.querySelector('[aria-label="Conversation"]')) await back(root)
  if (!root.querySelector('[aria-label="Agents"]')) await tab(root, 'Agents')
  const rows = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Agents"] .row-button')]
  await click(
    rows.find((row) => row.querySelector('strong')?.textContent === title),
    `conversation row ${title}`,
  )
}

// Home on a page that matches nothing: the task list without This page.
export const idle = (root: ParentNode) =>
  root.querySelector('[aria-label="Home"] [aria-label="Tasks"]') !== null &&
  root.querySelector('[aria-label="This page"]') === null
// The task the top bar names, with its tabs under it.
export const shownTask = (root: ParentNode) =>
  root.querySelector('[role="tablist"][aria-label="Task"]')
    ? (header(root).querySelector('.heading .title')?.textContent ?? null)
    : null
// An open conversation's title, as the top bar names it.
export const conversationTitle = (root: ParentNode) =>
  root.querySelector('[aria-label="Conversation"]')
    ? (header(root).querySelector('.heading .title')?.textContent ?? null)
    : null
