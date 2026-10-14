import { settle } from './fakeBrowser'

// Steps through the panel's views the way a person does, for the sidebar tests.

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

// Switches views from the bottom bar: Home, Agents, or Settings.
export async function tab(root: ParentNode, label: 'Home' | 'Agents' | 'Settings') {
  button(root.querySelector('nav')!, label)!.click()
  await settle(20)
}

export const openSettings = (root: ParentNode) => tab(root, 'Settings')

// Back from a conversation to the Agents list, or from Settings to Home.
export async function back(root: ParentNode) {
  const fromConversation = button(root.querySelector('header')!, 'Back')
  if (!fromConversation) return tab(root, 'Home')
  fromConversation.click()
  await settle(20)
}

// Switches Nodes from the Node chip's menu.
export async function useNode(root: ParentNode, label: string) {
  button(root.querySelector('header .menu-items')!, label)!.click()
  await settle(20)
}

// Makes a task current from the project's list on This page.
export async function useTask(root: ParentNode, title: string) {
  const rows = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="This page"] [aria-label="Tasks"] button')]
  rows.find((row) => row.querySelector('strong')?.textContent === title)!.click()
  await settle(20)
}

// Makes a task current the way a remembered one comes back: Home reads the stored choice again as
// Settings closes. A page that matches nothing offers no way to choose a task.
export async function rememberTask(root: ParentNode, storage: Map<string, unknown>, projectId: string, taskId: string) {
  storage.set('destination:n1', { projectId, taskId, sessionId: null })
  await openSettings(root)
  await back(root)
}

// Opens a conversation from Agents, going back to the list first when one is open.
export async function openChat(root: ParentNode, title: string) {
  if (root.querySelector('[aria-label="Conversation"]')) await back(root)
  else await tab(root, 'Agents')
  const rows = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Agents"] .row-button')]
  rows.find((row) => row.querySelector('strong')?.textContent === title)!.click()
  await settle(20)
}

// The current task and conversation, as the panel names them.
// Home on a page that matches nothing: the Acorn mark alone.
export const idle = (root: ParentNode) => root.querySelector('[aria-label="Home"] .idle') !== null
export const currentTask = (root: ParentNode) =>
  root.querySelector('[aria-label="Current task"] strong')?.textContent ?? null
// An open conversation's title, as the top bar names it.
export const conversationTitle = (root: ParentNode) =>
  root.querySelector('[aria-label="Conversation"]')
    ? (root.querySelector('header .heading[data-eyebrow] h1')?.textContent ?? null)
    : null
