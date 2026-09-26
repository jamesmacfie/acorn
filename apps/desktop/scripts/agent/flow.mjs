// Declarative flows for the agent-driven window (docs/local-development.md § Large-surface flow).
//
// A flow file is data: stages of named steps, each step one action from the fixed table below, with
// targets by role and accessible name, scroll fractions, window sizes, named wait conditions and named
// invariants. There is no field that holds code, and a field this parser does not know is an error,
// so a flow cannot smuggle a script in. Loops exist only as a `repeat` with a small stated count.
//
// The runner waits on stated health conditions and animation frames, never a fixed sleep. Invariants
// are recorded rather than thrown: a baseline run can fail some of them, and the report is only useful
// if the flow runs to the end and says which.
import { cpus, arch, platform, release, totalmem } from 'node:os'

const MAX_TIMEOUT_MS = 600_000
const MAX_REPEAT = 20
const MAX_FRACTIONS = 20
/** Mounted rows plus blocks a diff may hold at once, whatever its size: the viewport plus the
 *  virtualizer's overscan either side, with room to spare. Passing it at every profile is what makes
 *  mounted work an additive band rather than a multiple of the topology. */
export const MOUNTED_CEILING = 400

/** Which element scrolls for each surface kind. Held here so a flow names a surface, not a selector. */
const SCROLLERS = { diff: '.diff', timeline: '.ui-timeline-scroll' }
const SURFACES = Object.keys(SCROLLERS)

const WAITS = {
  ready: 'the surface reports its source-owned topology complete',
  content: 'rows are mounted and none of the visible ones is blank or uncovered',
  settled: 'no frames or held publications are pending and the mounted counts stopped changing',
  mounted: 'every projected turn is in the DOM',
  gone: 'no surface of that kind is registered',
}

const INVARIANTS = {
  noBlank: 'every visible mounted block has content and the viewport has no uncovered range',
  singleCommitPerFrame: 'no animation frame saw more than one geometry commit',
  noLateTopology: 'no source-owned block arrived after the surface was ready',
  boundedMount: `mounted rows and blocks stay under ${MOUNTED_CEILING}`,
  teardown: 'the surface unregistered with no observer, frame, queued or held work left',
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const snapshotWords = (snapshot) => [snapshot.text, ...(snapshot.elements ?? []).map((element) => element.name)].filter(Boolean).join('\n')

function fail(path, message) {
  throw new Error(`Flow ${path}: ${message}`)
}

function onlyKeys(value, allowed, path) {
  if (!isObject(value)) fail(path, 'must be an object')
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `unknown field "${key}"`)
}

function needString(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string')
}

function needNumber(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `must be a number from ${min} to ${max}`)
}

function needSurface(value, path) {
  if (!SURFACES.includes(value)) fail(path, `must be one of ${SURFACES.join(', ')}`)
}

function checkTarget(target, path) {
  onlyKeys(target, ['role', 'name', 'nameStartsWith'], path)
  if (target.role !== undefined) needString(target.role, `${path}.role`)
  if ((target.name === undefined) === (target.nameStartsWith === undefined)) fail(path, 'needs exactly one of name or nameStartsWith')
  needString(target.name ?? target.nameStartsWith, path)
}

/** Each action and the check for its arguments. The keys are the whole vocabulary. */
const ACTIONS = {
  click: (value, path) => {
    onlyKeys(value, ['target', 'optional'], path)
    checkTarget(value.target, `${path}.target`)
    if (value.optional !== undefined && typeof value.optional !== 'boolean') fail(`${path}.optional`, 'must be a boolean')
  },
  fill: (value, path) => {
    onlyKeys(value, ['target', 'text', 'optional'], path)
    checkTarget(value.target, `${path}.target`)
    if (typeof value.text !== 'string') fail(`${path}.text`, 'must be a string')
    if (value.optional !== undefined && typeof value.optional !== 'boolean') fail(`${path}.optional`, 'must be a boolean')
  },
  wait: (value, path) => {
    onlyKeys(value, ['surface', 'until', 'timeoutMs'], path)
    needSurface(value.surface, `${path}.surface`)
    if (!(value.until in WAITS)) fail(`${path}.until`, `must be one of ${Object.keys(WAITS).join(', ')}`)
    needNumber(value.timeoutMs, `${path}.timeoutMs`, 1, MAX_TIMEOUT_MS)
  },
  waitText: (value, path) => {
    onlyKeys(value, ['text', 'timeoutMs'], path)
    needString(value.text, `${path}.text`)
    needNumber(value.timeoutMs, `${path}.timeoutMs`, 1, MAX_TIMEOUT_MS)
  },
  assertText: (value, path) => {
    onlyKeys(value, ['contains', 'absent'], path)
    if (value.contains !== undefined && (!Array.isArray(value.contains) || !value.contains.every((item) => typeof item === 'string' && item.length))) {
      fail(`${path}.contains`, 'must be a list of non-empty strings')
    }
    if (value.absent !== undefined && (!Array.isArray(value.absent) || !value.absent.every((item) => typeof item === 'string' && item.length))) {
      fail(`${path}.absent`, 'must be a list of non-empty strings')
    }
    if (!(value.contains?.length || value.absent?.length)) fail(path, 'needs contains or absent')
  },
  captureText: (value, path) => needString(value, path),
  scroll: (value, path) => {
    onlyKeys(value, ['surface', 'fractions', 'settleMs'], path)
    needSurface(value.surface, `${path}.surface`)
    if (!Array.isArray(value.fractions) || !value.fractions.length || value.fractions.length > MAX_FRACTIONS) {
      fail(`${path}.fractions`, `must list 1 to ${MAX_FRACTIONS} fractions`)
    }
    value.fractions.forEach((fraction, index) => needNumber(fraction, `${path}.fractions[${index}]`, 0, 1))
    needNumber(value.settleMs, `${path}.settleMs`, 1, MAX_TIMEOUT_MS)
  },
  resize: (value, path) => {
    onlyKeys(value, ['width', 'height'], path)
    needNumber(value.width, `${path}.width`, 320, 8_000)
    needNumber(value.height, `${path}.height`, 240, 8_000)
  },
  frames: (value, path) => needNumber(value, path, 1, 120),
  checkpoint: (value, path) => needString(value, path),
  assert: (value, path) => {
    onlyKeys(value, ['surface', 'invariant'], path)
    needSurface(value.surface, `${path}.surface`)
    if (!(value.invariant in INVARIANTS)) fail(`${path}.invariant`, `must be one of ${Object.keys(INVARIANTS).join(', ')}`)
  },
  repeat: (value, path, depth) => {
    onlyKeys(value, ['times', 'steps'], path)
    if (!Number.isInteger(value.times) || value.times < 1 || value.times > MAX_REPEAT) fail(`${path}.times`, `must be a whole number from 1 to ${MAX_REPEAT}`)
    if (depth >= 1) fail(path, 'cannot nest inside another repeat')
    checkSteps(value.steps, `${path}.steps`, depth + 1)
  },
}

function checkSteps(steps, path, depth) {
  if (!Array.isArray(steps) || !steps.length) fail(path, 'must be a non-empty list of steps')
  steps.forEach((step, index) => {
    const at = `${path}[${index}]`
    if (!isObject(step)) fail(at, 'must be an object')
    const keys = Object.keys(step)
    if (keys.length !== 1) fail(at, `must hold exactly one action, found ${keys.length}`)
    const [action] = keys
    if (!(action in ACTIONS)) fail(at, `unknown action "${action}"`)
    ACTIONS[action](step[action], `${at}.${action}`, depth)
  })
}

const countAsserts = (steps) => steps.reduce((total, step) => total + ('assert' in step || 'assertText' in step ? 1 : 0) + ('repeat' in step ? countAsserts(step.repeat.steps) : 0), 0)

/** Parse and validate a flow file's contents. Throws on anything this runner would not do exactly. */
export function parseFlow(text) {
  const flow = typeof text === 'string' ? JSON.parse(text) : text
  onlyKeys(flow, ['name', 'description', 'stages'], 'file')
  needString(flow.name, 'name')
  if (flow.description !== undefined && typeof flow.description !== 'string') fail('description', 'must be a string')
  if (!Array.isArray(flow.stages) || !flow.stages.length) fail('stages', 'must be a non-empty list')
  const names = new Set()
  flow.stages.forEach((stage, index) => {
    const at = `stages[${index}]`
    onlyKeys(stage, ['name', 'steps'], at)
    needString(stage.name, `${at}.name`)
    if (names.has(stage.name)) fail(`${at}.name`, `repeats "${stage.name}"`)
    names.add(stage.name)
    checkSteps(stage.steps, `${at}.steps`, 0)
  })
  if (!flow.stages.some((stage) => countAsserts(stage.steps) > 0)) fail('stages', 'must assert at least one invariant')
  return flow
}

// ── Reading health ─────────────────────────────────────────────────────────────────────────────

const live = (health, kind) => (health?.surfaces ?? []).filter((entry) => entry.kind === kind)
/** The one surface of a kind a flow is about: the one with the most mounted, when a kind has two. */
const surfaceOf = (health, kind) => live(health, kind).sort((a, b) =>
  (b.mounted.fixedRows + b.mounted.dynamicBlocks) - (a.mounted.fixedRows + a.mounted.dynamicBlocks))[0]
const mountedOf = (entry) => entry.mounted.fixedRows + entry.mounted.dynamicBlocks

/** Each named invariant, as a pass and the numbers it was decided on. */
export function checkInvariant(health, kind, invariant) {
  const entry = surfaceOf(health, kind)
  if (invariant === 'teardown') {
    const retired = health?.retired?.[kind]
    const left = live(health, kind).length
    const detail = {
      live: left,
      observers: retired?.measurement.activeObservers ?? null,
      scheduledFrames: retired?.work.scheduledFrames ?? null,
      queued: retired?.work.queuedSegments ?? null,
      held: retired?.work.heldPublications ?? null,
    }
    const pass = left === 0 && !!retired && detail.observers === 0 && detail.scheduledFrames === 0 && detail.queued === 0 && detail.held === 0
    return { pass, detail }
  }
  if (!entry) return { pass: false, detail: { live: 0 } }
  if (invariant === 'noBlank') return { pass: entry.mounted.blankBlocks === 0 && entry.mounted.uncoveredRanges === 0, detail: { blank: entry.mounted.blankBlocks, uncovered: entry.mounted.uncoveredRanges } }
  if (invariant === 'singleCommitPerFrame') return { pass: entry.measurement.maxCommitsInFrame <= 1, detail: { maxCommitsInFrame: entry.measurement.maxCommitsInFrame } }
  if (invariant === 'noLateTopology') return { pass: entry.topology.lateSourceBlocks === 0, detail: { lateSourceBlocks: entry.topology.lateSourceBlocks } }
  if (invariant === 'boundedMount') return { pass: mountedOf(entry) <= MOUNTED_CEILING, detail: { mounted: mountedOf(entry), ceiling: MOUNTED_CEILING } }
  throw new Error(`Unknown invariant: ${invariant}`)
}

function waitMet(until, kind, now, previous) {
  const entry = surfaceOf(now, kind)
  if (until === 'gone') return !entry
  if (!entry) return false
  if (until === 'ready') return entry.topology.ready
  if (until === 'content') return mountedOf(entry) > 0 && entry.mounted.blankBlocks === 0 && entry.mounted.uncoveredRanges === 0
  // Every turn is either drawn or counted as hidden behind "Show earlier" (kit/lib/timelineWindow.ts).
  if (until === 'mounted') {
    return entry.mounted.dynamicBlocks > 0
      && entry.mounted.dynamicBlocks + (entry.window?.hiddenEarlier ?? 0) === entry.topology.dynamicBlocks
  }
  if (until === 'settled') {
    const before = surfaceOf(previous, kind)
    return !!before && entry.work.scheduledFrames === 0 && entry.work.heldPublications === 0
      && mountedOf(entry) === mountedOf(before) && entry.mounted.blankBlocks === before.mounted.blankBlocks
  }
  throw new Error(`Unknown wait: ${until}`)
}

// ── Running ────────────────────────────────────────────────────────────────────────────────────

/**
 * Drive `client` through a parsed flow. `client` is a WebDriverClient or anything with the same
 * methods, which is how the tests run this without a window.
 */
export async function runFlow(client, flow, { fixture = null, log = () => {} } = {}) {
  const started = Date.now()
  const report = {
    flow: flow.name,
    startedAt: new Date(started).toISOString(),
    environment: {
      os: `${platform()} ${release()}`,
      arch: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      cpus: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      node: process.version,
      build: 'debug, agent-automation',
      page: await client.environment().catch(() => null),
    },
    fixture,
    stages: [],
    asserts: [],
  }
  // WebKit runs no animation frames for a window that is covered or on a locked screen, so the
  // virtualized rows never draw and every wait would time out saying something misleading.
  if (report.environment.page?.visibility === 'hidden') {
    throw new Error('The Acorn window is hidden (document.visibilityState is "hidden"), so WebKit runs no animation frames and nothing can be measured. Bring it to the front, keep it uncovered, and run the flow again.')
  }
  let lastAction = Date.now()

  const run = async (steps, stage) => {
    for (const step of steps) {
      const [action] = Object.keys(step)
      const value = step[action]
      if (action === 'click' || action === 'fill') {
        const element = await client.find(value.target)
        if (!element) {
          if (value.optional) { stage.skipped.push(value.target.name ?? value.target.nameStartsWith); continue }
          throw new Error(`Stage "${stage.name}": no element ${JSON.stringify(value.target)} on the page.`)
        }
        if (action === 'click') await client.click(element)
        else await client.fill(element, value.text)
        lastAction = Date.now()
      } else if (action === 'wait') {
        const deadline = Date.now() + value.timeoutMs
        let previous = null
        for (;;) {
          await client.frames(2)
          const now = await client.surfaceHealth()
          if (waitMet(value.until, value.surface, now, previous)) {
            stage.waits.push({ surface: value.surface, until: value.until, ms: Date.now() - lastAction })
            break
          }
          if (Date.now() > deadline) throw new Error(`Stage "${stage.name}": ${value.surface} was not ${value.until} within ${value.timeoutMs}ms (${WAITS[value.until]}).`)
          previous = now
        }
      } else if (action === 'waitText') {
        const deadline = Date.now() + value.timeoutMs
        let seen = ''
        for (;;) {
          seen = snapshotWords(await client.snapshot())
          if (seen.includes(value.text)) {
            stage.waits.push({ text: value.text, ms: Date.now() - lastAction })
            break
          }
          if (Date.now() > deadline) throw new Error(`Stage "${stage.name}": the window did not show ${JSON.stringify(value.text)} within ${value.timeoutMs}ms.`)
          await client.frames(2)
        }
      } else if (action === 'scroll') {
        for (const fraction of value.fractions) {
          const place = await client.scrollToFraction(SCROLLERS[value.surface], fraction)
          if (!place) throw new Error(`Stage "${stage.name}": the ${value.surface} has no scroller on the page.`)
          lastAction = Date.now()
          await run([{ wait: { surface: value.surface, until: 'settled', timeoutMs: value.settleMs } }], stage)
          const health = await client.surfaceHealth()
          stage.checkpoints.push({ name: `scroll ${fraction}`, atMs: Date.now() - started, place, health })
          const shown = checkInvariant(health, value.surface, 'noBlank')
          report.asserts.push({ stage: stage.name, at: `scroll ${fraction}`, surface: value.surface, invariant: 'noBlank', ...shown })
        }
      } else if (action === 'resize') {
        await client.setWindowSize(value.width, value.height)
        lastAction = Date.now()
      } else if (action === 'frames') {
        await client.frames(value)
      } else if (action === 'checkpoint') {
        stage.checkpoints.push({ name: value, atMs: Date.now() - started, health: await client.surfaceHealth() })
      } else if (action === 'captureText') {
        stage.checkpoints.push({ name: value, atMs: Date.now() - started, text: snapshotWords(await client.snapshot()).slice(0, 20_000) })
      } else if (action === 'assert') {
        const result = checkInvariant(await client.surfaceHealth(), value.surface, value.invariant)
        report.asserts.push({ stage: stage.name, surface: value.surface, invariant: value.invariant, ...result })
      } else if (action === 'assertText') {
        const text = snapshotWords(await client.snapshot())
        const missing = (value.contains ?? []).filter((item) => !text.includes(item))
        const present = (value.absent ?? []).filter((item) => text.includes(item))
        report.asserts.push({ stage: stage.name, surface: 'window', invariant: 'text', pass: !missing.length && !present.length, detail: { missing, present } })
      } else if (action === 'repeat') {
        for (let time = 0; time < value.times; time++) await run(value.steps, stage)
      }
    }
  }

  for (const definition of flow.stages) {
    const stage = { name: definition.name, startedMs: Date.now() - started, waits: [], checkpoints: [], skipped: [] }
    report.stages.push(stage)
    log(`stage ${definition.name}`)
    await run(definition.steps, stage)
    stage.durationMs = Date.now() - started - stage.startedMs
  }
  report.durationMs = Date.now() - started
  report.failed = report.asserts.filter((entry) => !entry.pass).length
  report.spans = await client.performanceEntries('acorn:').catch(() => [])
  return report
}

/** A few lines a person can read: each stage's waits, then every invariant that failed. */
export function summarizeReport(report) {
  const lines = [`${report.flow}: ${report.stages.length} stages in ${Math.round(report.durationMs / 1000)}s, ${report.asserts.length - report.failed} of ${report.asserts.length} invariants held.`]
  if (report.fixture) lines.push(`Fixture ${report.fixture.name} ${report.fixture.profile} seed ${report.fixture.seed}: ${report.fixture.files} files, ${report.fixture.fixedRows} rows, ${report.fixture.events} events.`)
  for (const stage of report.stages) {
    const waits = stage.waits.map((wait) => wait.text ? `text ${JSON.stringify(wait.text)} ${wait.ms}ms` : `${wait.surface} ${wait.until} ${wait.ms}ms`).join(', ')
    lines.push(`  ${stage.name} (${Math.round(stage.durationMs)}ms)${waits ? `: ${waits}` : ''}${stage.skipped.length ? `; skipped ${stage.skipped.join(', ')}` : ''}`)
  }
  for (const entry of report.asserts.filter((item) => !item.pass)) {
    lines.push(`  FAILED ${entry.stage}${entry.at ? ` at ${entry.at}` : ''}: ${entry.surface} ${entry.invariant} ${JSON.stringify(entry.detail)}`)
  }
  return lines.join('\n')
}
