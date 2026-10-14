import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { CallError, HostState } from '../messages'

// What each failure means for the person, with the next thing to do. One place, so the pairing
// form, the Node list, and the project list say the same thing about the same state.

export const INSTALL_COMMAND = 'acorn browser install'

// The bridge states that installing it fixes. The panel shows the command for them, and checks again.
export const installFixes = (host: HostState): boolean => host.state === 'missing' || host.state === 'forbidden'

export function hostGuidance(host: HostState): string | null {
  switch (host.state) {
    case 'missing':
      return 'The Acorn browser bridge is not installed. Run this in a terminal:'
    case 'forbidden':
      return 'The installed bridge does not allow this extension. Run this in a terminal to repair it:'
    case 'exited':
      return `${host.message ?? 'The bridge stopped.'} Retry, or run \`acorn browser status\` to check the install.`
    default:
      return null
  }
}

export function errorGuidance(error: CallError): string {
  switch (error.code) {
    case 'revoked':
      return 'The Node no longer accepts this browser. Forget the Node, then pair it again.'
    case 'identity_mismatch':
      return 'The Node presented a different certificate. Check with whoever runs it, then forget it and pair again.'
    case 'incompatible':
      return `${error.message} Update whichever side is older.`
    case 'node_unreachable':
      return 'The Node is not answering. Check that it is running and reachable, then retry.'
    case 'pairing_required':
      return 'This browser has no credential for that Node. Forget it and pair again.'
    case 'host_unavailable':
      return `${error.message} Retry once the bridge is installed.`
    default:
      return error.message
  }
}

export function statusGuidance(status: NodeStatus | null): { label: string; detail: string | null } {
  if (!status) return { label: 'Connecting', detail: null }
  if (status.error?.code === 'identity_mismatch')
    return { label: 'Identity changed', detail: errorGuidance({ code: 'identity_mismatch', message: '' }) }
  switch (status.state) {
    case 'online':
      return { label: 'Online', detail: null }
    case 'degraded':
      return { label: 'Online, live updates paused', detail: null }
    case 'revoked':
      return { label: 'Revoked', detail: errorGuidance({ code: 'revoked', message: '' }) }
    case 'incompatible':
      return {
        label: 'Incompatible',
        detail: 'This Node speaks another protocol version. Update whichever side is older.',
      }
    case 'offline':
      return { label: 'Offline', detail: errorGuidance({ code: 'node_unreachable', message: '' }) }
  }
}
