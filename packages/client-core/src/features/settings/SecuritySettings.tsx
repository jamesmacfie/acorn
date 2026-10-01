import { createResource, createSignal, Show } from 'solid-js'
import type { NodeSecurityPosture } from '@acorn/protocol/api.ts'
import { nodes } from '../../infra/node/fleet'
import { createNodeBackup, nodeSecurityPosture, suggestedBackupPath } from '../../infra/node/nodeSecurity'
import { Alert, Button, Input } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import './settings.css'

// Settings → Security and backup (docs/security.md § On-disk): whether the node's disk is encrypted,
// and an archive of its databases. The audit trail that used to share this page is Settings → Audit log
// (./AuditLogSettings.tsx).
//
// Per node, following the settings header's node switcher: "is the disk encrypted" isn't a property a
// fleet has.

export default function SecuritySettings(props: { nodeId: string | null }) {
  const nodeId = () => props.nodeId
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null
  const [error, setError] = createSignal('')

  const [posture] = createResource<NodeSecurityPosture | null, string>(
    () => nodeId() ?? '',
    async (id) => (id ? await nodeSecurityPosture(id).catch(() => null) : null),
  )

  // The node's suggestion, and whatever the owner typed over it. Kept apart so switching nodes
  // re-suggests without discarding a path the owner is halfway through editing, and so an empty field
  // means "use the suggestion" rather than "back up to nowhere".
  const [destPath, setDestPath] = createSignal('')
  const [backingUp, setBackingUp] = createSignal(false)
  const [backupDone, setBackupDone] = createSignal('')
  const [suggestion] = createResource<string | null, string>(
    () => nodeId() ?? '',
    async (id) => {
      setDestPath('')
      setBackupDone('')
      return id ? await suggestedBackupPath(id).then((s) => s.suggestedPath).catch(() => null) : null
    },
  )

  const runBackup = async () => {
    const target = destPath().trim() || suggestion()
    if (!target) return
    setError('')
    setBackupDone('')
    setBackingUp(true)
    try {
      const result = await createNodeBackup(target, nodeId() ?? undefined)
      setBackupDone(`Wrote ${Math.round(result.bytes / 1024).toLocaleString()} KB to ${result.path}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBackingUp(false)
    }
  }

  // Three states, not two. `null` means the node cannot tell — the honest answer off macOS, where a
  // perfectly well encrypted LUKS volume is indistinguishable from an unencrypted one without
  // guessing. Rendering that as "not encrypted" would be a confident wrong answer.
  const encryption = (current: NodeSecurityPosture) =>
    current.diskEncrypted === true ? 'On' : current.diskEncrypted === false ? 'Off' : `Not detectable on ${current.platform}`

  return (
    <>
      <SettingsSection id="encryption" label="Disk encryption">
        <Show when={posture()?.diskEncrypted === false}>
          <Alert tone="warn" variant="banner">
            <strong>{node()?.label ?? 'This node'}</strong> does not have full-disk encryption turned
            on. Acorn encrypts credentials and backup archives only — worktrees, caches, scrollback
            and agent transcripts rely on the operating system.
          </Alert>
        </Show>
        <SettingRow label="Full-disk encryption">
          <span class="muted">
            {posture() ? encryption(posture()!) : posture.loading ? 'Asking the node…' : 'The node did not say.'}
          </span>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="backup"
        label="Backup"
        description="Writes this node's databases to one archive on that node's machine. Credentials, device tokens and the TLS key are left out, so restoring means entering them again and pairing again. Worktrees and the blob cache are left out too, because git and GitHub hold both."
      >
        <SettingRow label="Archive path" layout="stacked" error={error() || undefined}>
          <Input
            label="Archive path"
            value={destPath()}
            placeholder={suggestion() ?? 'Loading…'}
            onInput={(value) => setDestPath(value)}
          />
          <Button size="sm" disabled={backingUp() || !(destPath() || suggestion())} onPress={() => void runBackup()}>
            {backingUp() ? 'Backing up…' : 'Back up this node'}
          </Button>
          <Show when={backupDone()}>{(done) => <span class="muted">{done()}</span>}</Show>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
