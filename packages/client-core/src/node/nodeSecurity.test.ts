import { describe, expect, it } from 'vitest'
import { shouldWarnAboutDisk } from './nodeSecurity'

// The disk-encryption warning's decision, isolated from the fetch and the notice ring around it
// (docs/data-layer.md § Backup and import). Extracted for a test because it is a three-valued input
// to a boolean, and getting it wrong either way is easy to miss: warn on `null` and every Linux node
// nags forever about a perfectly well encrypted volume; treat `null` as encrypted and that happens to
// be right, which is what makes the wrong version look reasonable while you write it.

const posture = (diskEncrypted: boolean | null) => ({ diskEncrypted, platform: 'darwin' })

describe('shouldWarnAboutDisk', () => {
  it('warns when the node reports an unencrypted disk', () => {
    expect(shouldWarnAboutDisk(posture(false), 'node-a', [])).toBe(true)
  })

  it('says nothing when the disk is encrypted', () => {
    expect(shouldWarnAboutDisk(posture(true), 'node-a', [])).toBe(false)
  })

  it('says nothing when the node cannot tell', () => {
    // `null` is the honest answer off macOS, where LUKS, dm-crypt and ZFS native encryption all count
    // and probing for them badly would produce a confident wrong answer. A warning nobody can act on
    // is one they learn to dismiss, including the ones that matter.
    expect(shouldWarnAboutDisk(posture(null), 'node-a', [])).toBe(false)
  })

  it('warns once per node, not once per device', () => {
    expect(shouldWarnAboutDisk(posture(false), 'node-a', ['node-a'])).toBe(false)
    // A second node with an unencrypted disk is a second thing the owner does not know about, even on
    // a device that has already been warned about the first.
    expect(shouldWarnAboutDisk(posture(false), 'node-b', ['node-a'])).toBe(true)
  })
})
