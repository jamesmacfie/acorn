import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { workflowTaskHierarchy } from '../../packages/client-core/src/features/tasks/taskHierarchy.ts'
import { applyRailOrder, parseRailOrder, isPinned } from '../../packages/client-core/src/features/tabs/railOrder.ts'

const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
const timed = (run: () => unknown, repeats = 10) => {
  for (let i = 0; i < 3; i++) run()
  const elapsed: number[] = []
  const cpu: number[] = []
  for (let round = 0; round < 7; round++) {
    const before = process.cpuUsage()
    const at = performance.now()
    for (let i = 0; i < repeats; i++) run()
    elapsed.push((performance.now() - at) / repeats)
    const used = process.cpuUsage(before)
    cpu.push((used.user + used.system) / 1000 / repeats)
  }
  return { elapsedMedianMs: median(elapsed), cpuMedianMs: median(cpu), rounds: 7, callsPerRound: repeats }
}
type Row = { id: string; parentId: string | null; origin: string; projectId: string }
const rows = (n: number, shape: string): Row[] => Array.from({ length: n }, (_, i) => ({
  id: `task-${i}`,
  parentId: i === 0 || shape === 'flat' ? null : shape === 'broad' ? 'task-0' : shape === 'balanced' ? `task-${Math.floor((i - 1) / 4)}` : `task-${i - 1}`,
  origin: i === 0 || shape === 'flat' ? 'local' : 'workflows:child',
  projectId: `project-${i % 20}`,
}))
const hierarchy = []
for (const shape of ['flat', 'broad', 'balanced', 'chain']) {
  for (const count of [6, 100, 300, 1_000, ...(shape === 'chain' ? [2_000] : [])]) {
    const tasks = rows(count, shape)
    let parentReads = 0
    const counted = tasks.map(task => ({ ...task, get parentId() { parentReads++; return task.parentId } }))
    const projected = workflowTaskHierarchy(counted, new Set(), tasks.at(-1)!.id)
    let failure: string | null = null
    let duration: unknown = null
    try { duration = timed(() => workflowTaskHierarchy(tasks, new Set(), tasks.at(-1)!.id), count >= 2_000 ? 1 : 10) }
    catch (error) { failure = error instanceof Error ? error.message : String(error) }
    hierarchy.push({ shape, tasks: count, visible: projected.length, parentReads, duration, failure })
  }
}
const rail = []
for (const count of [6, 100, 300, 1_000]) {
  const tasks = rows(count, 'flat')
  const json = JSON.stringify({ pinned: tasks.filter((_, i) => i % 10 === 0).map(t => t.id), order: tasks.map(t => t.id) })
  // Exact parse/isPinned expression used by each row's markers and row target, without DOM costs.
  const rowReads = () => tasks.map(t => [isPinned(parseRailOrder(json), t.id), isPinned(parseRailOrder(json), t.id)])
  const onceParsed = () => { const order = parseRailOrder(json); return tasks.map(t => [isPinned(order, t.id), isPinned(order, t.id)]) }
  rail.push({ tasks: count, orderCharacters: json.length, parsesPerMountRowPass: 2 * count,
    repeatedOwnerCalls: timed(rowReads, count >= 1_000 ? 2 : 10), onceParsedComparator: timed(onceParsed, 10) })
}
const railProjection = []
for (const count of [6, 100, 300, 1_000]) {
  const tasks = rows(count, 'flat')
  const projectCount = count === 6 ? 2 : 20
  const projects = Array.from({ length: projectCount }, (_, i) => ({ id: `project-${i}`, hidden: false }))
  for (let i = 0; i < tasks.length; i++) tasks[i]!.projectId = `project-${i % projectCount}`
  const workspaceProjects = projects.map(p => p.id)
  const json = JSON.stringify({ pinned: [], order: tasks.map(t => t.id) })
  let probes = 0
  const counted = projects.map(p => ({ ...p, get id() { probes++; return p.id } }))
  const projectSet = new Set(workspaceProjects)
  tasks.filter(t => projectSet.has(t.projectId) && !counted.find(p => p.id === t.projectId)?.hidden)
  const run = () => {
    const inWorkspace = new Set(workspaceProjects)
    const scoped = tasks.filter(t => inWorkspace.has(t.projectId) && !projects.find(p => p.id === t.projectId)?.hidden)
    return workflowTaskHierarchy(applyRailOrder(scoped, parseRailOrder(json)), new Set(), tasks.at(-1)!.id)
  }
  railProjection.push({ tasks: count, projects: projectCount, projectIdComparisonsPerProjection: probes, duration: timed(run, 10), provenance: 'exact TabRail orderedTasks/taskRows expressions over synthetic plain data; no DOM' })
}
const result = { environment: { node: process.version, platform: process.platform, arch: process.arch, commit: 'f8e4b59c', synthetic: true }, hierarchy, rail, railProjection }
writeFileSync(new URL(`./07-rail-${tag}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
