import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { GitSettings, IdentityValue, IdentityWrite, IdentityWriteResult } from '../shared/api'
import { repositoryFor } from './history'

type Core = Pick<CoreServices, 'git' | 'projects' | 'prefs'>
export const PULL_POLICY_PREF = 'git.pullPolicy'
export const AUTO_FETCH_PREF = 'git.autoFetch'
const first = (text: string) => text.trim().split('\n')[0] || 'Git config failed.'

async function config(core: Core, repository: string, args: string[]) {
  return core.git.git(['config', ...args], { cwd: repository, maxOutputBytes: 8192, timeoutMs: 10_000 })
}

async function identity(core: Core, repository: string, key: 'user.name' | 'user.email'): Promise<IdentityValue> {
  const [effective, local, global] = await Promise.all([
    config(core, repository, ['--show-origin', '--show-scope', '--null', '--get', key]),
    config(core, repository, ['--local', '--get', key]),
    config(core, repository, ['--global', '--get', key]),
  ])
  const [scope, origin, value] = effective.code === 0 ? effective.stdout.split('\0') : []
  return {
    value: value ?? null,
    scope: scope ?? null,
    origin: origin ?? null,
    local: local.code === 0 ? local.stdout.trimEnd() : null,
    global: global.code === 0 ? global.stdout.trimEnd() : null,
  }
}

export async function gitSettings(core: Core, projectId: string, userId: string): Promise<GitSettings> {
  const repository = await repositoryFor(core, projectId)
  const [name, email, policy, fetch] = await Promise.all([
    identity(core, repository, 'user.name'),
    identity(core, repository, 'user.email'),
    core.prefs.read(userId, PULL_POLICY_PREF),
    core.prefs.read(userId, AUTO_FETCH_PREF),
  ])
  return {
    repository,
    name,
    email,
    pullPolicy: policy === 'rebase' ? 'rebase' : 'ff-only',
    autoFetch: fetch === 'true',
  }
}

export async function writeIdentity(
  core: Core,
  projectId: string,
  userId: string,
  request: IdentityWrite,
): Promise<IdentityWriteResult> {
  const before = await gitSettings(core, projectId, userId)
  const write = async (key: string, value: string) => {
    try {
      if ((await repositoryFor(core, projectId)) !== before.repository)
        return { ok: false, error: 'Project repository changed. Reopen Git settings.' }
      const result = await config(core, before.repository, [`--${request.scope}`, '--replace-all', key, value])
      return { ok: result.code === 0, error: result.code === 0 ? null : first(result.stderr) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const name = await write('user.name', request.name)
  const email = await write('user.email', request.email)
  try {
    const settings = await gitSettings(core, projectId, userId)
    if (settings.repository === before.repository) return { name, email, settings, readbackError: null }
    return {
      name,
      email,
      settings: before,
      readbackError: 'Project repository changed during readback. Inspect identity on the original repository.',
    }
  } catch (error) {
    return {
      name,
      email,
      settings: before,
      readbackError: `Identity readback failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function writeGitPreference(
  core: Core,
  projectId: string,
  userId: string,
  key: typeof PULL_POLICY_PREF | typeof AUTO_FETCH_PREF,
  value: string,
  onWritten: () => void = () => {},
): Promise<GitSettings> {
  const before = await repositoryFor(core, projectId)
  await core.prefs.write(userId, key, value)
  onWritten()
  try {
    const settings = await gitSettings(core, projectId, userId)
    if (settings.repository !== before)
      throw new BridgeError(
        409,
        'repository_moved',
        'Preference saved, but project repository changed during readback. Reopen Git settings.',
      )
    return settings
  } catch (error) {
    if (error instanceof BridgeError && error.code === 'repository_moved') throw error
    throw new BridgeError(
      503,
      'preference_readback_failed',
      `Preference saved, but Git settings readback failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
