// The two agent operations that publish content past the owner's machine: a transcript export and
// a provider send that carries attachments (docs/security/secret-publication.md § Agents). The
// detector and the gate are core's; this module picks the exact bytes each operation consumes.
//
// Both run only while blocking is on. Off, export and send behave exactly as before.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  decodeSecretInput,
  describeSecretRefusal,
  scanSecretText,
  secretReport,
  type SecretPublicationGate,
} from '@acorn/plugin-api/node'
import type { SecretFinding, SecretPublicationRefusal, SecretUnscanned } from '@acorn/protocol/secretChecks.ts'

/** A transcript larger than this is unscanned, which the gate treats as incomplete. */
export const EXPORT_SCAN_MAX_BYTES = 64 << 20
/** Text attachments are already capped at 1 MiB on upload (./attachmentStore.ts). */
export const ATTACHMENT_SCAN_MAX_BYTES = 1 << 20

export class SecretPublicationRefused extends Error {
  constructor(
    readonly refusal: SecretPublicationRefusal,
    remedy?: string,
  ) {
    super(describeSecretRefusal(refusal, remedy))
  }
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

/** Admit one export of exactly `content`. `digest` identifies the content without its export time,
 *  so an allowance survives the re-export that follows it. */
export async function admitExport(
  gate: SecretPublicationGate | undefined,
  input: {
    sessionId: string
    format: 'json' | 'markdown'
    variant: 'original' | 'redacted'
    content: string
    digest: string
  },
): Promise<void> {
  if (!gate || !(await gate.enabled())) return
  const location = `${input.variant} ${input.format} export`
  const oversized = Buffer.byteLength(input.content) > EXPORT_SCAN_MAX_BYTES
  const report = secretReport({
    digest: input.digest,
    findings: oversized ? [] : scanSecretText(input.content, location),
    unscanned: oversized ? [{ location, reason: `Larger than ${EXPORT_SCAN_MAX_BYTES >> 20} MiB.` }] : [],
    limits: ['Checks the serialized export. The stored session is unchanged.'],
  })
  const refusal = await gate.admit({
    operation: 'export',
    destination: `session ${input.sessionId} as ${location}`,
    report,
  })
  if (refusal)
    throw new SecretPublicationRefused(
      refusal,
      input.variant === 'original' ? 'Choose an export without secrets from the session menu instead' : undefined,
    )
}

export type OutgoingAttachment = { id: string; filename: string; mediaType: string; localPath: string }

/** Admit a provider send that carries these attachments, by their stored bytes. Text formats are
 *  scanned; images, PDFs, and other formats are reported unscanned, never as clean. */
export async function admitAttachments(
  gate: SecretPublicationGate | undefined,
  input: {
    sessionId: string
    providerId: string
    attachments: readonly OutgoingAttachment[]
  },
): Promise<void> {
  if (!input.attachments.length || !gate || !(await gate.enabled())) return
  const findings: SecretFinding[] = []
  const unscanned: SecretUnscanned[] = []
  const identities: string[] = []
  for (const attachment of [...input.attachments].sort((a, b) => a.id.localeCompare(b.id))) {
    const location = `${attachment.filename} (${attachment.id})`
    const bytes = await readFile(attachment.localPath).catch(() => null)
    if (!bytes) {
      unscanned.push({ location, reason: 'The attachment could not be read.' })
      identities.push(`${attachment.id}:unreadable`)
      continue
    }
    identities.push(`${attachment.id}:${sha256(bytes)}`)
    if (!attachment.mediaType.startsWith('text/')) {
      unscanned.push({ location, reason: 'Images, PDFs, and other non-text formats are not scanned.' })
      continue
    }
    const decoded = decodeSecretInput(bytes, ATTACHMENT_SCAN_MAX_BYTES)
    if ('unscanned' in decoded) unscanned.push({ location, reason: decoded.unscanned })
    else findings.push(...scanSecretText(decoded.text, location))
  }
  const report = secretReport({
    digest: sha256(JSON.stringify(identities)),
    findings,
    unscanned,
    limits: ['Checks attachments only. The message text and files the agent reads itself are not checked.'],
  })
  const refusal = await gate.admit({
    operation: 'send',
    destination: `${input.providerId} session ${input.sessionId}`,
    report,
  })
  if (refusal) throw new SecretPublicationRefused(refusal, 'Remove the attachment')
}
