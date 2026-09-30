import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_DOCKER_CONFIG_BYTES, readRepoDockerConfig } from './repoDockerConfig'
import { loadDockerLayers } from './dockerConfig'

const home = vi.hoisted(() => vi.fn())
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: home }))

const temps: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'acorn-docker-config-'))
  temps.push(dir)
  const root = join(dir, 'checkout')
  home.mockReturnValue(join(dir, 'synthetic-home'))
  await mkdir(join(root, '.acorn'), { recursive: true })
  return { dir, root, path: join(root, '.acorn', 'config.toml') }
}
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('repository Docker configuration read', () => {
  it('reads ordinary files and safe internal aliases', async () => {
    const { root, path } = await fixture()
    const content = '[docker]\ncompose_project="own"\n'
    await writeFile(join(root, 'settings.toml'), content)
    await symlink('../settings.toml', path)
    expect(await readRepoDockerConfig(root)).toBe(content)
    expect((await loadDockerLayers(root)).repo).toEqual({ composeProject: 'own' })
  })

  it('refuses external leaf and directory aliases and ignores their hints', async () => {
    const { dir, root, path } = await fixture()
    const outside = join(dir, 'outside.toml')
    await writeFile(outside, '[docker]\ncompose_project="foreign"\n')
    await symlink(outside, path)
    await expect(readRepoDockerConfig(root)).rejects.toThrow('outside')
    expect((await loadDockerLayers(root)).repo).toEqual({})
    await rm(join(root, '.acorn'), { recursive: true })
    await mkdir(join(dir, 'foreign'))
    await writeFile(join(dir, 'foreign', 'config.toml'), 'foreign')
    await symlink(join(dir, 'foreign'), join(root, '.acorn'))
    await expect(readRepoDockerConfig(root)).rejects.toThrow('outside')
  })

  it('rejects oversized and non-regular files', async () => {
    const { root, path } = await fixture()
    await writeFile(path, Buffer.alloc(MAX_DOCKER_CONFIG_BYTES + 1))
    await expect(readRepoDockerConfig(root)).rejects.toThrow('Invalid')
    expect((await loadDockerLayers(root)).repo).toEqual({})
    await rm(path)
    await mkdir(path)
    await expect(readRepoDockerConfig(root)).rejects.toThrow()
  })

  it('preserves the owner-home fallback when repository input is unsafe', async () => {
    const { dir, root, path } = await fixture()
    const ownerHome = join(dir, 'synthetic-home', '.acorn')
    await mkdir(ownerHome, { recursive: true })
    await writeFile(join(ownerHome, 'config.toml'), '[docker]\ncompose_project="owner-choice"\nmatch_name=false\n')
    await mkdir(path)
    const layers = await loadDockerLayers(root)
    expect(layers.repo).toEqual({})
    expect(layers.home).toEqual({ composeProject: 'owner-choice', matchName: false })
    expect(layers.effective).toEqual({ composeProject: 'owner-choice', matchLabels: [], matchName: false })
  })

  it.skipIf(process.platform === 'win32')('rejects a FIFO without waiting for a writer', async () => {
    const { root, path } = await fixture()
    execFileSync('mkfifo', [path])
    await expect(readRepoDockerConfig(root)).rejects.toThrow('Invalid')
  }, 2_000)
})
