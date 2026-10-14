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

export async function openSettings(root: ParentNode) {
  button(root.querySelector('header')!, 'Settings')!.click()
  await settle(20)
}

// Back from Settings or a conversation.
export async function back(root: ParentNode) {
  button(root.querySelector('.view-head')!, 'Back')!.click()
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

// Opens a conversation from Agents, going back to Home first when one is open.
export async function openChat(root: ParentNode, title: string) {
  if (root.querySelector('[aria-label="Conversation"]')) await back(root)
  const rows = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Agents"] .row-button')]
  rows.find((row) => row.querySelector('strong')?.textContent?.endsWith(` · ${title}`))!.click()
  await settle(20)
}

// The current task and conversation, as the panel names them.
export const currentTask = (root: ParentNode) =>
  root.querySelector('[aria-label="Current task"] strong')?.textContent ?? null
export const conversationTitle = (root: ParentNode) =>
  root.querySelector('[aria-label="Conversation"] .subhead .grow')?.textContent ?? null
