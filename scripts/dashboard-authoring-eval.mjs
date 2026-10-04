import { writeFile } from 'node:fs/promises'

// Run against an authenticated development Node with a real model backend. This records outcomes
// without copying provider records or authored plans into the report.
const cases = [
  ['1-all-pulls', 'Show all my pull requests'],
  ['2-review', 'Show pull requests waiting for my review'],
  ['3-ready', 'Show pull requests ready to merge'],
  ['4-inactive', 'Show pull requests with no recent activity'],
  ['5-summary', 'Summarize pull requests by repository'],
  ['7-ci-history', 'Show my GitHub Actions runs over the last eight weeks, including runs older than GitHub returns'],
  ['8-open-history', 'Show how many issues were open on each day of the last month'],
  ['9-release-checklist', 'Show a release checklist assembled from milestones, checks, issues, and approval'],
  ['12-worktrees', 'Show worktrees and unfinished changes'],
  ['13-assigned', 'Show my assigned work across trackers'],
  ['18-usage', 'Show AI usage and cost by task'],
  ['26-awaiting-reply', 'Show messages that ask me a direct question and still await my reply'],
  ['variant-wording', 'List every PR I have open'],
  ['variant-two-accounts', 'Show my pull requests from either GitHub account'],
  ['variant-ambiguous-reach', 'Show all pull requests'],
  ['variant-unadded-source', 'Show my calendar conflicts'],
  ['variant-no-answer', 'Show the weather on Mars'],
]
const { ACORN_EVAL_URL: url, ACORN_EVAL_TOKEN: token, ACORN_EVAL_BACKEND_ID: backendId,
  ACORN_EVAL_WORKSPACE_ID: workspaceId, ACORN_EVAL_MODEL_ID: modelId } = process.env
if (!url || !token || !backendId || !workspaceId) {
  throw new Error('Set ACORN_EVAL_URL, ACORN_EVAL_TOKEN, ACORN_EVAL_BACKEND_ID, and ACORN_EVAL_WORKSPACE_ID.')
}
const output = process.argv[2] ?? `/tmp/acorn-dashboard-authoring-eval-${Date.now()}.jsonl`
const results = []
for (const [id, instruction] of cases) {
  const response = await fetch(new URL('/v1/core/authoring/turn', url), {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ target: 'dashboard', scope: { workspaceId }, targetId: `eval-${id}`, baseRevision: 0,
      base: { version: 2, title: 'Evaluation', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' }, sources: [], columns: [], stages: [], view: { kind: 'table' } },
      backendId, ...(modelId ? { modelId } : {}), instruction, context: [], samplesEnabled: false }),
  })
  const answer = await response.json().catch(() => ({}))
  const result = { id, httpStatus: response.status, state: answer.state ?? 'error',
    modelId: answer.modelId ?? modelId ?? '', providerId: answer.providerId ?? '',
    problemCount: answer.problems?.length ?? 0, unaddressedCount: answer.unaddressed?.length ?? 0,
    requirementCount: answer.candidate?.requirements?.length ?? 0,
    sourceCount: answer.candidate?.sources?.length ?? 0, stageCount: answer.candidate?.stages?.length ?? 0,
    requestCount: answer.usage?.requests ?? 0 }
  results.push(result)
  process.stdout.write(`${id}: ${result.state} (${result.problemCount} problems, ${result.unaddressedCount} unaddressed)\n`)
}
await writeFile(output, `${results.map(result => JSON.stringify(result)).join('\n')}\n`, { mode: 0o600 })
process.stdout.write(`Wrote ${output}\n`)
