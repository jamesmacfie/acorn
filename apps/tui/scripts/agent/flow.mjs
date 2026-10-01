import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ACTIONS = {
  wait: ['action', 'text', 'timeoutMs'],
  press: ['action', 'key'],
  type: ['action', 'text'],
  paste: ['action', 'text'],
  resize: ['action', 'cols', 'rows'],
  assert: ['action', 'contains', 'absent'],
  checkpoint: ['action', 'label'],
}

const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)

export function validateFlow(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !Array.isArray(value.steps)) {
    throw new Error('A flow needs a name and a steps array.')
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.name) || value.steps.length < 1 || value.steps.length > 100) {
    throw new Error('Flow name or step count is invalid.')
  }
  let checks = 0
  for (const [index, step] of value.steps.entries()) {
    const allowed = ACTIONS[step?.action]
    if (!allowed || Object.keys(step).some((key) => !allowed.includes(key))) {
      throw new Error(`Step ${index + 1} has an unknown action or field.`)
    }
    if (['wait', 'type', 'paste'].includes(step.action) && (typeof step.text !== 'string' || !step.text)) {
      throw new Error(`Step ${index + 1} needs text.`)
    }
    if (step.action === 'press' && (typeof step.key !== 'string' || !step.key)) throw new Error(`Step ${index + 1} needs a key.`)
    if (step.action === 'checkpoint' && (typeof step.label !== 'string' || !/^[a-z0-9-]+$/.test(step.label))) {
      throw new Error(`Step ${index + 1} needs a file-safe label.`)
    }
    if (step.action === 'resize' && (!Number.isInteger(step.cols) || !Number.isInteger(step.rows) || step.cols < 40 || step.cols > 500 || step.rows < 20 || step.rows > 500)) {
      throw new Error(`Step ${index + 1} has an invalid size.`)
    }
    if (step.action === 'wait') {
      if (step.timeoutMs !== undefined && (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 120_000)) {
        throw new Error(`Step ${index + 1} has an invalid timeout.`)
      }
      checks += 1
    }
    if (step.action === 'assert') {
      if (step.contains !== undefined && !strings(step.contains)) throw new Error(`Step ${index + 1} has invalid contains values.`)
      if (step.absent !== undefined && !strings(step.absent)) throw new Error(`Step ${index + 1} has invalid absent values.`)
      if (!(step.contains?.length || step.absent?.length)) throw new Error(`Step ${index + 1} has no assertion.`)
      checks += 1
    }
  }
  if (!checks) throw new Error('A flow must assert what appeared on screen.')
  return value
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

export async function runFlow(flow, request, directory) {
  validateFlow(flow)
  const reportDirectory = join(directory, 'reports')
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const reportPath = join(reportDirectory, `${flow.name}-${stamp}.json`)
  const report = { flow: flow.name, startedAt: new Date().toISOString(), steps: [], status: 'running' }
  let screen = null
  const snapshot = async () => (screen = await request('snapshot'))
  const saveFrame = async (label, index) => {
    const path = join(reportDirectory, `${flow.name}-${stamp}-${String(index).padStart(2, '0')}-${label}.txt`)
    await writeFile(path, `${(await snapshot()).text}\n`, { mode: 0o600 })
    return path
  }
  try {
    for (const [index, step] of flow.steps.entries()) {
      if (step.action === 'press') await request('press', { key: step.key })
      else if (step.action === 'type' || step.action === 'paste') await request(step.action, { text: step.text })
      else if (step.action === 'resize') await request('resize', { cols: step.cols, rows: step.rows })
      else if (step.action === 'wait') {
        const deadline = Date.now() + (step.timeoutMs ?? 15_000)
        do {
          if ((await snapshot()).text.includes(step.text)) break
          await delay(100)
        } while (Date.now() < deadline)
        if (!screen.text.includes(step.text)) throw new Error(`The screen did not show ${JSON.stringify(step.text)}.`)
      } else if (step.action === 'assert') {
        const { text } = await snapshot()
        for (const value of step.contains ?? []) if (!text.includes(value)) throw new Error(`The screen is missing ${JSON.stringify(value)}.`)
        for (const value of step.absent ?? []) if (text.includes(value)) throw new Error(`The screen still shows ${JSON.stringify(value)}.`)
      } else if (step.action === 'checkpoint') {
        report.steps.push({ index: index + 1, action: step.action, label: step.label, frame: await saveFrame(step.label, index + 1) })
        continue
      }
      report.steps.push({ index: index + 1, action: step.action, status: 'passed' })
    }
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'
    report.error = error instanceof Error ? error.message : String(error)
    report.lastFrame = await saveFrame('failure', report.steps.length + 1)
  } finally {
    report.finishedAt = new Date().toISOString()
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  }
  if (report.status === 'failed') throw new Error(`${report.error} Report: ${reportPath}`)
  return { reportPath, report }
}
