import { expect, it } from 'vitest'
import type { AgentAttachment } from '../../plugins/agents/src/contract/wire'
import type { AgentBeforePermissionPayload, AgentPermissionSubject } from '../../plugins/agents/src/contract/permissionHook'
import type { AgentAfterToolPayload, AgentBeforeToolPayload } from '../../plugins/agents/src/contract/loopHook'
import type {
  SessionMessage,
  SessionMessageResult,
  SessionMessenger,
  SessionMessengerContribution,
} from '../../plugins/agents/src/contract/sessionMessages'
import type { TurnFollowUpContribution, TurnFollowUpWindow } from '../../plugins/agents/src/contract/turnFollowUp'
import type { AgentSessionControl } from '../../plugins/agents/src/contract/sessionExecute'
import type {
  AgentActivityCapability,
  AgentLifecycleFrame,
  AgentRequestsCapability,
  AgentReviewInputCapability,
} from '../../plugins/agents/src/contract/lifecycle'
import type * as Published from '../../packages/plugin-types/src/public'

// The published declarations are independent of the bundled Agents plugin. Assert both directions
// here so neither package imports the other just to check their shared shapes. The brackets compare a
// union whole; bare, one matching member would pass for all of them.
type Mutual<A, B> = [[A] extends [B] ? true : never, [B] extends [A] ? true : never]
const attachment: Mutual<AgentAttachment, Published.DraftAttachment> = [true, true]

// What a plugin outside this repository answers or calls (docs/managed-agents/permission-policy.md,
// loop-hooks.md, session-messages.md, unattended-follow-ups.md, session-events.md, session-control.md).
const permissionSubject: Mutual<AgentPermissionSubject, Published.AgentPermissionSubject> = [true, true]
const beforePermission: Mutual<AgentBeforePermissionPayload, Published.AgentBeforePermissionPayload> = [true, true]
const beforeTool: Mutual<AgentBeforeToolPayload, Published.AgentBeforeToolPayload> = [true, true]
const afterTool: Mutual<AgentAfterToolPayload, Published.AgentAfterToolPayload> = [true, true]
const message: Mutual<SessionMessage, Published.SessionMessage> = [true, true]
const messageResult: Mutual<SessionMessageResult, Published.SessionMessageResult> = [true, true]
const messenger: Mutual<SessionMessenger, Published.SessionMessenger> = [true, true]
const messengerEntry: Mutual<SessionMessengerContribution, Published.SessionMessengerContribution> = [true, true]
const followUpWindow: Mutual<TurnFollowUpWindow, Published.TurnFollowUpWindow> = [true, true]
const followUpEntry: Mutual<TurnFollowUpContribution, Published.TurnFollowUpContribution> = [true, true]
const sessionControl: Mutual<AgentSessionControl, Published.AgentSessionControl> = [true, true]
const requests: Mutual<AgentRequestsCapability, Published.AgentRequestsCapability> = [true, true]
const reviewInput: Mutual<AgentReviewInputCapability, Published.AgentReviewInputCapability> = [true, true]
const activity: Mutual<AgentActivityCapability, Published.AgentActivityCapability> = [true, true]
const activityFrame: Mutual<Extract<AgentLifecycleFrame, { channel: 'plugin:agents:activity' }>, Published.AgentActivityFrame> = [true, true]

it('keeps published draft attachments aligned with Agents', () => {
  expect(attachment).toEqual([true, true])
})

it('keeps the published Agents hook payloads, entries, and capabilities aligned with Agents', () => {
  for (const pair of [permissionSubject, beforePermission, beforeTool, afterTool, message, messageResult, messenger, messengerEntry, followUpWindow, followUpEntry, sessionControl, requests, reviewInput, activity, activityFrame]) {
    expect(pair).toEqual([true, true])
  }
})
