import type { ParsedArgs } from './args'

export function writeOutput(value: unknown, args: ParsedArgs): void {
  if (args.output === 'jsonl') {
    for (const row of Array.isArray(value) ? value : [value]) process.stdout.write(`${JSON.stringify(row)}\n`)
    return
  }
  if (args.output === 'json') {
    process.stdout.write(`${JSON.stringify(value)}\n`)
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: string }).kind === 'RunList') {
    const list = value as { runs: unknown[]; failedSources: string[]; note: string }
    process.stderr.write(
      `acorn: ${list.note}${list.failedSources.length ? ` Failed sources: ${list.failedSources.join(', ')}.` : ''}\n`,
    )
    writeOutput(list.runs, args)
    return
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: string }).kind === 'WorkflowDefinitionList'
  ) {
    const list = value as { definitions: unknown[]; errors: { source: string; message: string }[] }
    for (const error of list.errors) process.stderr.write(`acorn: ${error.source}: ${error.message}\n`)
    writeOutput(list.definitions, args)
    return
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['TaskScripts', 'TaskScriptWait'].includes((value as { kind?: string }).kind ?? '')
  ) {
    const scripts = value as {
      kind: string
      taskId?: string
      setup?: Record<string, unknown>
      teardown?: Record<string, unknown>
      snapshot?: Record<string, unknown>
      matched?: boolean
      reason?: string
    }
    const phases = scripts.kind === 'TaskScripts' ? [scripts.setup!, scripts.teardown!] : [scripts.snapshot!]
    writeOutput(
      phases.map((phase) => ({
        taskId: phase.taskId,
        phase: phase.phase,
        state: phase.state,
        reason: phase.reason,
        attemptId: phase.attemptId,
        generation: phase.generation,
        exitCode: phase.exitCode,
        startedAt: phase.startedAt,
        finishedAt: phase.finishedAt,
        ...(scripts.kind === 'TaskScriptWait' ? { matched: scripts.matched, waitReason: scripts.reason } : {}),
      })),
      args,
    )
    return
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: string }).kind === 'TaskScriptLogs'
  ) {
    const logs = value as { output: string; available: boolean; truncated: boolean }
    if (!logs.available) process.stderr.write('acorn: Output unavailable for this attempt.\n')
    if (logs.truncated) process.stderr.write('acorn: Earlier output omitted; showing a bounded tail.\n')
    // PTY diagnostics are text, never a command stream for the reader's terminal.
    const output = logs.output
      .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    process.stdout.write(output + (output && !output.endsWith('\n') ? '\n' : ''))
    return
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: string }).kind === 'PairingWindow'
  ) {
    const window = value as { endpoints: string[]; identity: string; code: string; expiresAt: string }
    const minutes = Math.round((Date.parse(window.expiresAt) - Date.now()) / 60_000)
    const lines = [
      `Connect to    ${window.endpoints.join('\n              ')}`,
      `Identity      ${window.identity}`,
      `Pairing code  ${window.code}   (valid ${minutes} minutes)`,
      '',
      'On the other machine, open Settings → Nodes, add a node, and check that the identity words match.',
    ]
    if (window.endpoints.every((endpoint) => /^https:\/\/(127\.0\.0\.1|\[::1\]|localhost)[:/]/.test(endpoint)))
      lines.push(
        "That address works on this computer only. To reach the Node from another machine, run acorn node reach with this computer's address or name.",
      )
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: string }).kind === 'NodeReach'
  ) {
    const reach = value as {
      source: string
      port: number
      endpoints: string[]
      candidates: { address: string; interface: string }[]
      restartRequired: boolean
      restarted: boolean
    }
    const lines = [
      reach.endpoints.length
        ? `Connect to    ${reach.endpoints.join('\n              ')}`
        : `Connect to    https://127.0.0.1:${reach.port}  (this computer only)`,
      ...(reach.source === 'none'
        ? []
        : [`Set by        ${reach.source === 'environment' ? 'ACORN_ADVERTISE_HOST' : 'node.json'}`]),
      `Addresses     ${reach.candidates.map((candidate) => `${candidate.address} (${candidate.interface})`).join(', ') || 'none'}`,
    ]
    if (reach.restarted) lines.push('', 'The Node restarted to apply the change.')
    else if (reach.restartRequired)
      lines.push(
        '',
        'The Node answers on its earlier list until it restarts. Run acorn node restart if acorn started it. Otherwise, quit and reopen the desktop app, or restart the process that runs the Node.',
      )
    if (!reach.endpoints.length)
      lines.push(
        '',
        'To let other machines reach the Node, run acorn node reach with an address above or a name for this computer.',
      )
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }
  const rows = Array.isArray(value) ? value : [value]
  if (!rows.length) return
  const objects = rows as Record<string, unknown>[]
  const columns = Object.keys(objects[0]!).filter((key) => !['apiVersion', 'kind', 'nodeId'].includes(key))
  const cells = (row: Record<string, unknown>) =>
    columns.map((key) => {
      const value = row[key]
      const rendered =
        value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)
      return rendered.replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\t', '\\t')
    })
  if (!args.noHeader) process.stdout.write(`${columns.join('\t')}\n`)
  for (const row of objects) process.stdout.write(`${cells(row).join('\t')}\n`)
}
