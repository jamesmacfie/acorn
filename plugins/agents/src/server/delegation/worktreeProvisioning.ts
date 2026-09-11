import type { CreateAgentSessionInput } from '../../shared/schemas'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { promptWithResultContract } from '../sessions/resultContract'
import type { AgentDelegationStore, AgentSpawn, AgentSpawnProvisioning } from './store'

export type WorktreeTaskService = {
  createChild(parentTaskId: string, seed: { title: string; branch: string }, intendedChildId?: string): Promise<string>
}

/** Recoverable provisioning across core's task database and the Agents plugin database. */
export class WorktreeProvisioning {
  constructor(
    private readonly runtime: ManagedAgentRuntime,
    private readonly store: AgentDelegationStore,
    private readonly tasks?: WorktreeTaskService,
  ) {}

  async reconcile(): Promise<void> {
    for (const spawn of await this.store.creatingWorktrees()) {
      try {
        await this.provision(spawn)
      } catch (error) {
        await this.store.fail(spawn.id, error)
      }
    }
  }

  async provision(spawn: AgentSpawn): Promise<AgentSpawn> {
    if (!this.tasks) throw new Error('Worktree delegation is unavailable because the core task service is missing.')
    const plan = spawn.provisioning
    if (!plan) throw new Error('Worktree delegation recovery data is missing or invalid.')

    const taskId = await this.tasks.createChild(
      spawn.ownerTaskId,
      { title: plan.title, branch: plan.branch },
      spawn.childTaskId,
    )
    if (taskId !== spawn.childTaskId) throw new Error('Core returned a different child task during replay.')

    let session = await this.runtime.store.delegatedSessionForSpawn(spawn.id)
    if (session && session.taskId !== spawn.childTaskId) {
      throw new Error('The recovered delegated session belongs to another task.')
    }
    session ??= await this.runtime.acceptSession(sessionInput(spawn, plan), `delegation:${spawn.id}:session`)
    await this.store.recordSession(spawn.id, session.id)

    const turnKey = `delegation:${spawn.id}:turn`
    let turn = await this.runtime.store.turnForIdempotency(session.id, turnKey)
    turn ??= await this.runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: promptWithResultContract(plan.prompt, plan.resultSchema) }],
      source: 'delegation',
      effectivePolicy: {
        delegationSpawnId: spawn.id,
        toolCeiling: plan.toolCeiling,
        ...(plan.resultSchema ? { resultSchema: plan.resultSchema } : {}),
        ...(plan.configOptions ? { configOptions: plan.configOptions } : {}),
      },
      idempotencyKey: turnKey,
    })
    return this.store.complete(spawn.id, session.id, turn.id)
  }
}

const sessionInput = (spawn: AgentSpawn, plan: AgentSpawnProvisioning): CreateAgentSessionInput => ({
  taskId: spawn.childTaskId,
  providerId: plan.providerId,
  profileId: plan.profileId,
  title: plan.title,
  kind: 'delegated',
  parentSessionId: plan.parentSessionId ?? undefined,
  parentTurnId: plan.parentTurnId ?? undefined,
  config: {
    delegationSpawnId: spawn.id,
    toolCeiling: plan.toolCeiling,
    ...(plan.resultSchema ? { resultSchema: plan.resultSchema } : {}),
    ...(plan.configOptions ? { requestedConfigOptions: plan.configOptions } : {}),
  },
})
