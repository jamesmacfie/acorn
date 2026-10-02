import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const read = (kind, phase) => JSON.parse(readFileSync(`plans/performance/unit24-${kind}-${phase}-verified.json`, 'utf8'))
const comparison = []
for (const kind of ['workflow', 'processing']) {
  const before = read(kind, 'before'), after = read(kind, 'after')
  assert.equal(before.hashes.probe, after.hashes.probe)
  const measures = result => kind === 'workflow'
    ? [result.navigation, result.runList, result.taskRead]
    : [...result.pages, result.snapshot, result.attempts]
  const left = measures(before.result), right = measures(after.result)
  assert.equal(left.length, right.length)
  for (let index = 0; index < left.length; index++) {
    const a = left[index], b = right[index]
    assert.equal(a.name, b.name)
    assert.deepEqual(a.answer, b.answer, a.name)
    comparison.push({ case: kind, name: a.name, completeAnswerEqual: true,
      rows: [a.selectedRows, b.selectedRows], valueBytes: [a.selectedValueBytes, b.selectedValueBytes],
      cpuMs: [a.cpuMs, b.cpuMs], wallMs: [a.wallMs, b.wallMs] })
  }
}
writeFileSync('plans/performance/unit24-comparison.json', `${JSON.stringify(comparison, null, 2)}\n`)
process.stdout.write(`${comparison.length} complete response comparisons pass; paired probe hashes match.\n`)
