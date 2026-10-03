import { createEffect, createResource, createSignal, on, Show } from 'solid-js'
import type { NodeSecurityPosture } from '@acorn/protocol/api.ts'
import { nodes } from '../../infra/node/fleet'
import { createNodeBackup, nodeSecurityPosture, suggestedBackupPath } from '../../infra/node/nodeSecurity'
import { Alert, Button, Input } from '../../kit/components/primitives'
import { Facts } from '../../kit/components/content/Facts'
import { Text } from '../../kit/components/content/Text'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import './settings.css'

// Settings → Security and backup (docs/security/audit.md § Filesystem and backup): whether the node's disk is encrypted,
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
  // The suggestion goes in as the field's value, so the field shows the path the button will write
  // to. Only into an empty field, and only when a suggestion arrives, so it never replaces what the
  // owner typed and a field they cleared stays clear.
  createEffect(on(suggestion, (suggested) => {
    if (suggested && !destPath().trim()) setDestPath(suggested)
  }))

  const runBackup = async () => {
    const target = destPath().trim() || suggestion()
    if (!target) return
    setError('')
    setBackupDone('')
    setBackingUp(true)
    try {
      const result = await createNodeBackup(target, nodeId() ?? undefined)
      setBackupDone(`Saved ${Math.round(result.bytes / 1024).toLocaleString()} KB to ${result.path}.`)
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
    current.diskEncrypted === true ? 'On' : current.diskEncrypted === false ? 'Off' : `Can't tell on ${current.platform}`

  return (
    <>
      <SettingsSection id="encryption" label="Disk encryption">
        <Show when={posture()?.diskEncrypted === false}>
          <Alert tone="warn" variant="banner">
            Full-disk encryption is off on {node() && !node()!.local ? node()!.label : 'this computer'}. acorn encrypts
            your credentials and backups. Your code, terminal history, and agent transcripts are only as
            safe as the disk.
          </Alert>
        </Show>
        {/* A fact, not a setting: it lines up with the controls on other pages (05-13). */}
        <Facts
          grouping="rows"
          items={[{ label: 'Full-disk encryption', value: posture() ? encryption(posture()!) : posture.loading ? 'Checking…' : 'Unknown' }]}
        />
      </SettingsSection>

      <SettingsSection
        id="backup"
        label="Backup"
        description="Saves this node's data to one file on that computer."
        help="Credentials, pairings, and the security certificate aren't included, so after a restore you sign in and pair again. Worktrees aren't included either, because git holds them."
      >
        <SettingRow label="Save to" layout="stacked" error={error() || undefined}>
          <Input
            label="Save to"
            value={destPath()}
            onInput={(value) => setDestPath(value)}
          />
          <Button disabled={backingUp() || !(destPath() || suggestion())} onPress={() => void runBackup()}>
            {backingUp() ? 'Backing up…' : 'Back up this node'}
          </Button>
          <Show when={backupDone()}>{(done) => <Text emphasis="muted" wrap>{done()}</Text>}</Show>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
