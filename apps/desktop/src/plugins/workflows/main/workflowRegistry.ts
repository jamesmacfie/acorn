import type { PolicyEvaluator, StepHandler, WorkflowTriggerContribution } from './workflowContracts'

class NamedRegistry<T> {
  readonly #entries = new Map<string, T>()

  constructor(private readonly kind: string) {}

  register(id: string, contribution: T): () => void {
    if (!id.trim()) throw new Error(`${this.kind} id must not be empty.`)
    if (this.#entries.has(id)) throw new Error(`Duplicate ${this.kind} '${id}'.`)
    this.#entries.set(id, contribution)
    return () => this.#entries.delete(id)
  }

  get(id: string): T | undefined {
    return this.#entries.get(id)
  }

  ids(): string[] {
    return [...this.#entries.keys()]
  }

  values(): T[] {
    return [...this.#entries.values()]
  }
}

export class WorkflowContributionRegistry {
  readonly stepKinds = new NamedRegistry<StepHandler>('workflow step kind')
  readonly policies = new NamedRegistry<PolicyEvaluator>('workflow policy')
  readonly triggers = new NamedRegistry<WorkflowTriggerContribution>('workflow trigger')

  registerStepKind(id: string, handler: StepHandler): () => void {
    return this.stepKinds.register(id, handler)
  }

  registerPolicy(id: string, evaluator: PolicyEvaluator): () => void {
    return this.policies.register(id, evaluator)
  }

  registerTrigger(trigger: WorkflowTriggerContribution): () => void {
    return this.triggers.register(trigger.id, trigger)
  }
}

