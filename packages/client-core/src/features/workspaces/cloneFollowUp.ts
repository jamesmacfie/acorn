// What a clone form offers to do once the clone finishes, such as running a workflow on it
// (docs/workflows/starting-runs.md § After a clone). The workflows plugin provides it. Core declares the
// key because core's form consumes it and can't import a plugin. With no provider, the form only clones.
import type { Component } from 'solid-js'
import { clientCapabilityId } from '../../infra/node/clientCapabilities'
import type { CloneRequest } from './cloneRun'

export type CloneFollowUpChoice = {
  /** The form's submit label, such as "Clone and run" or "Retry". */
  label: string
  ready: boolean
  /** Clones, then follows up, and opens what it made. Resolves the new project, what to show, or null
   *  once the form stops following. */
  start(request: CloneRequest): Promise<{ ok: true; projectId: string } | { ok: false; error: string } | null>
}

export type CloneFollowUpPickerProps = {
  nodeId: string | null
  /** The workspace the form files the clone in, when it names one. */
  workspaceId?: string
  disabled: boolean
  /** A choice the form's submit runs instead of a plain clone, or null for a plain clone. */
  onChange(choice: CloneFollowUpChoice | null): void
}

export type CloneFollowUp = { Picker: Component<CloneFollowUpPickerProps> }

export const CLONE_FOLLOW_UP = clientCapabilityId<CloneFollowUp>('workspaces.cloneFollowUp')
