// The agent card on a line of a task's change request, for a surface that isn't the change request's
// own diff, such as a plugin's tree (docs/plugins/remote-trees.md). Only the code host knows the
// request's patches, which name the line's conversation, so each code host provides the card under its
// own id and this finds the one the task's request is on.
import type { Component } from 'solid-js'
import { clientCapability, clientCapabilityId } from '../../infra/node/clientCapabilities'
import { taskById } from '../tasks/taskLookup'
import type { ChangeRequestLineProps } from '../../kit/diff/diffNotes'

export type ChangeRequestLines = {
  /** The card for lines of this task's change request. It reads the request's diff, so call it inside
   *  the component that draws the cards. */
  forTask(taskId: string): Component<ChangeRequestLineProps>
}

/** Where the code host with this plugin id provides its cards. */
export const changeRequestLinesId = (provider: string) =>
  clientCapabilityId<ChangeRequestLines>(`${provider}.changeRequestLines`)

/** The card for lines of the task's change request, or undefined when its code host has none. */
export function changeRequestLineCard(taskId: string): Component<ChangeRequestLineProps> | undefined {
  const provider = taskById(taskId)?.changeRequest?.provider
  return provider ? clientCapability(changeRequestLinesId(provider))?.forTask(taskId) : undefined
}
