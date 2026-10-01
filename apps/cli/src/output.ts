import type { ParsedArgs } from './args'

export function writeOutput(value: unknown, args: ParsedArgs): void {
  if (args.output === 'jsonl') {
    for (const row of Array.isArray(value) ? value : [value]) process.stdout.write(`${JSON.stringify(row)}\n`)
    return
  }
  if (args.output === 'json') { process.stdout.write(`${JSON.stringify(value)}\n`); return }
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: string }).kind === 'RunList') {
    const list = value as { runs: unknown[]; failedSources: string[]; note: string }
    process.stderr.write(`acorn: ${list.note}${list.failedSources.length ? ` Failed sources: ${list.failedSources.join(', ')}.` : ''}\n`)
    writeOutput(list.runs, args)
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: string }).kind === 'WorkflowDefinitionList') {
    const list = value as { definitions: unknown[]; errors: { source: string; message: string }[] }
    for (const error of list.errors) process.stderr.write(`acorn: ${error.source}: ${error.message}\n`)
    writeOutput(list.definitions, args)
    return
  }
  const rows = Array.isArray(value) ? value : [value]
  if (!rows.length) return
  const objects = rows as Record<string, unknown>[]
  const columns = Object.keys(objects[0]!).filter((key) => !['apiVersion', 'kind', 'nodeId'].includes(key))
  const cells = (row: Record<string, unknown>) => columns.map((key) => {
    const value = row[key]
    const rendered = value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return rendered.replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\t', '\\t')
  })
  if (!args.noHeader) process.stdout.write(`${columns.join('\t')}\n`)
  for (const row of objects) process.stdout.write(`${cells(row).join('\t')}\n`)
}
