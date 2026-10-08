import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentMcpPackagePlan, AgentMcpServer } from '../shared/mcpServers'
import type { AgentMcpPackageTest } from '../shared/mcpServers'
import { McpPackageInstaller, type McpPackagePlan } from './mcpPackageInstall'
import type { AgentMcpServerStore } from './mcpServerStore'
import { mcpReviewFindings, presentMcpTools } from './mcpReviewPresentation'
import { probeMcpCatalogue } from './mcpProbe'

const PLAN_LIFETIME_MS = 10 * 60_000

export class McpPackageManager {
  readonly #installer: McpPackageInstaller
  readonly #store: AgentMcpServerStore
  readonly #root: string
  readonly #pending = new Map<string, { plan: McpPackagePlan; createdAt: number; targetName: string; targetRevision: string | null; testedBin?: string }>()

  constructor(root: string, npmPath: string, store: AgentMcpServerStore) {
    this.#root = root
    this.#installer = new McpPackageInstaller(root, npmPath)
    this.#store = store
  }

  async plan(coordinate: string, targetName: string, expectedRevision: string | null, exceptions: Array<{ coordinate: string; reason: string }>, signal: AbortSignal): Promise<AgentMcpPackagePlan> {
    await this.#expire()
    await this.cleanOrphans().catch(() => undefined)
    if (this.#pending.size >= 4) throw new Error('Discard an older MCP package plan before planning another.')
    await this.#assertTarget(targetName, expectedRevision)
    const plan = await this.#installer.plan(coordinate, exceptions, signal)
    try { await this.#assertTarget(targetName, expectedRevision) }
    catch (error) { await this.#installer.discard(plan); throw error }
    const id = randomUUID()
    this.#pending.set(id, { plan, createdAt: Date.now(), targetName, targetRevision: expectedRevision })
    return {
      id, package: plan.coordinate.name, version: plan.coordinate.version,
      bins: plan.bins, graph: plan.graph, lockDigest: plan.lockDigest, treeDigest: plan.treeDigest,
      registry: plan.registry, runtime: plan.runtime, installer: plan.installer,
      exceptions: plan.exceptions,
    }
  }

  async testPlan(name: string, id: string, bin: string, signal: AbortSignal): Promise<AgentMcpPackageTest> {
    await this.#expire()
    const pending = this.#pending.get(id)
    if (!pending || pending.targetName !== name) throw new Error('The staged MCP package plan expired or belongs to another server.')
    await this.#assertTarget(name, pending.targetRevision)
    const preview = await this.#installer.preview(pending.plan, bin)
    const current = pending.targetRevision
      ? await this.#store.resolve([name], 'staged MCP package test', signal)
      : { servers: [], secrets: [], unavailable: [] }
    if (current.unavailable.length) throw new Error('The selected server needs consent or its stored credentials could not be opened.')
    const prior = current.servers[0]
    if (prior && prior.transport !== 'stdio') throw new Error('Only a managed command server can be updated by package installation.')
    const before = prior ? await probeMcpCatalogue(prior, current.secrets, signal) : null
    const catalogue = await probeMcpCatalogue({ transport: 'stdio', name, command: process.execPath, args: [preview.entry], env: prior?.transport === 'stdio' ? prior.env : {} }, current.secrets, signal)
    signal.throwIfAborted()
    await this.#installer.preview(pending.plan, bin)
    await this.#assertTarget(name, pending.targetRevision)
    pending.testedBin = bin
    const tools = presentMcpTools(catalogue.tools, current.secrets)
    return { digest: catalogue.digest, version: catalogue.version, tools,
      previousTools: presentMcpTools(before?.tools ?? [], current.secrets), findings: mcpReviewFindings(tools) }
  }

  async activate(name: string, id: string, bin: string, enabled: boolean, signal: AbortSignal): Promise<AgentMcpServer> {
    await this.#expire()
    const pending = this.#pending.get(id)
    if (!pending) throw new Error('The MCP package plan expired. Plan the installation again.')
    if (pending.targetName !== name || pending.testedBin !== bin) throw new Error('Test the chosen staged binary before activating this server.')
    await this.#assertTarget(name, pending.targetRevision)
    const current = await this.#store.get(name)
    const values = current?.values.map((value) => ({ name: value.name, secret: value.secret, ...(value.secret ? {} : { value: value.value ?? '' }) })) ?? []
    this.#pending.delete(id)
    try {
      const installed = await this.#installer.activate(pending.plan, bin, signal)
      signal.throwIfAborted()
      return await this.#store.saveManaged(name, installed, values, enabled, pending.targetRevision)
    } catch (error) {
      await this.#installer.discard(pending.plan)
      throw error
    }
  }

  async #assertTarget(name: string, revision: string | null): Promise<void> {
    const current = await this.#store.get(name)
    if (revision === null) {
      if (current) throw new Error('A server with that name was saved while this package was staged.')
    } else if (!current?.managed || current.revision !== revision) {
      throw new Error('The managed server changed while this package was staged. Plan the update again.')
    }
  }

  async cleanOrphans(): Promise<void> {
    const selected = new Set((await this.#store.list()).flatMap((server) => server.managed ? [join(this.#root, `${server.managed.lockDigest}-${server.managed.installationId}`)] : []))
    await this.#installer.cleanOrphans(selected)
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#pending.values()].map(({ plan }) => this.#installer.discard(plan)))
    this.#pending.clear()
  }

  async #expire(): Promise<void> {
    for (const [id, pending] of this.#pending) {
      if (Date.now() - pending.createdAt < PLAN_LIFETIME_MS) continue
      this.#pending.delete(id)
      await this.#installer.discard(pending.plan)
    }
  }
}
