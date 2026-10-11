// "Allow agent invocation": the owner reads what would run and decides which agent inputs and limits
// to allow (docs/agent-tools/workflow-tools.md § Invocation authority). Drawn with the kit, so the
// terminal client offers the same review.
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmButton,
  Field,
  Fold,
  Inline,
  Input,
  Modal,
  ModalActions,
  ModalBody,
  SectionHeader,
  Stack,
  Text,
} from '@acorn/plugin-api/ui'
import type { WorkflowInvocationReview } from '../../shared/workflowInvocation'
import { workflowApi } from '../workflowsClient'
import TypedValueField from './TypedValueField'
import { initialInvocationForm, invocationApproval, invocationStatus, type InvocationForm } from './invocationModel'

const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'The request failed.')

export default function InvocationDialog(props: {
  projectId: string
  definitionKey: string
  name: string
  onClose: () => void
}) {
  const [review, { refetch }] = createResource(() => workflowApi.invocationReview(props.projectId, props.definitionKey))
  const [form, setForm] = createSignal<InvocationForm>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  createEffect(() => {
    const loaded = review()
    if (loaded) setForm(initialInvocationForm(loaded))
  })
  const loaded = () => review()!
  const status = () => invocationStatus(loaded())
  const patch = (change: Partial<InvocationForm>) => setForm((current) => current && { ...current, ...change })
  const allowInput = (name: string, allowed: boolean) => {
    const current = form()?.callerInputs ?? []
    patch({ callerInputs: allowed ? [...current, name] : current.filter((item) => item !== name) })
  }

  const approve = async (loaded: WorkflowInvocationReview) => {
    const prepared = invocationApproval(loaded, props.projectId, form()!)
    if ('problem' in prepared) return setError(prepared.problem)
    setBusy(true)
    setError('')
    try {
      await workflowApi.approveInvocation(prepared.approval)
      await refetch()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  const revoke = async () => {
    setBusy(true)
    setError('')
    try {
      await workflowApi.revokeInvocation(props.projectId, props.definitionKey)
      await refetch()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Agent invocation: ${props.name}`} size="lg" onDismiss={props.onClose}>
      <ModalBody>
        <Show when={!review.error} fallback={<Alert tone="danger">{errorText(review.error)}</Alert>}>
          <Show when={review() && form()}>
            <Stack gap="stack">
              <Inline gap="inline" wrap>
                <Badge tone={status().tone}>{status().label}</Badge>
                <Text emphasis="muted" wrap>
                  Agents with the workflow_run tool turned on can start the version you approve here, in this project
                  only.
                </Text>
              </Inline>
              <Show when={error()}>
                <Alert tone="danger">{error()}</Alert>
              </Show>
              <Show when={loaded().changed}>
                <Alert tone="warn">
                  The workflow or a workflow it calls changed after you approved it. Agents can't start it until you
                  approve this version.
                </Alert>
              </Show>
              <Show when={loaded().posture === 'autonomous'}>
                <Alert tone="warn">This workflow runs autonomously, so it skips human approval gates.</Alert>
              </Show>

              <SectionHeader level="sub">What would run</SectionHeader>
              <For each={loaded().nodes}>
                {(node) => (
                  <Fold
                    label={
                      node.path.length > 1 ? `${node.name} (called from ${node.path.slice(1).join(' › ')})` : node.name
                    }
                    level="group"
                    defaultOpen={node.path.length === 1}
                  >
                    <Stack gap="row">
                      <For each={node.steps}>
                        {(step) => (
                          <Text wrap>
                            {[
                              step.name,
                              step.kind,
                              step.profileId,
                              step.model,
                              ...Object.entries(step.configOptions ?? {}).map(([key, value]) => `${key} ${value}`),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </For>
                    </Stack>
                  </Fold>
                )}
              </For>

              <Show when={loaded().inputs.length}>
                <SectionHeader level="sub">Inputs</SectionHeader>
                <For each={loaded().inputs}>
                  {(input) => {
                    const allowed = () => form()!.callerInputs.includes(input.name)
                    const uses = () => loaded().inputUses.filter((use) => use.inputs.includes(input.name))
                    return (
                      <Stack gap="row">
                        <Checkbox
                          label={`Agents may set ${input.label ?? input.name}`}
                          checked={allowed()}
                          onChange={(checked) => allowInput(input.name, checked)}
                        />
                        <Show when={uses().length}>
                          <Text emphasis="muted" wrap>
                            Reaches{' '}
                            {uses()
                              .map((use) => `${use.step} (${use.field})`)
                              .join(', ')}
                            .
                          </Text>
                        </Show>
                        <Show when={!allowed()}>
                          <TypedValueField
                            label={`Fixed value for ${input.label ?? input.name}`}
                            hint={input.hasDefault ? 'Leave empty to use the workflow default.' : undefined}
                            schema={input.schema}
                            value={form()!.fixedInputs[input.name]}
                            onChange={(value) => {
                              const next = { ...form()!.fixedInputs }
                              if (value === undefined) delete next[input.name]
                              else next[input.name] = value
                              patch({ fixedInputs: next })
                            }}
                          />
                        </Show>
                      </Stack>
                    )
                  }}
                </For>
              </Show>

              <SectionHeader level="sub">Limits for each run</SectionHeader>
              <Field label="Most turns" group>
                <Input
                  label="Most turns"
                  type="number"
                  min={1}
                  value={form()!.maxTurns}
                  onInput={(maxTurns) => patch({ maxTurns })}
                />
              </Field>
              <Field label="Longest run, in minutes" group>
                <Input
                  label="Longest run, in minutes"
                  type="number"
                  min={1}
                  value={form()!.maxMinutes}
                  onInput={(maxMinutes) => patch({ maxMinutes })}
                />
              </Field>
              <Field label="Most cost, in US dollars" hint="Optional." group>
                <Input
                  label="Most cost, in US dollars"
                  type="number"
                  min={0}
                  value={form()!.maxCostUsd}
                  onInput={(maxCostUsd) => patch({ maxCostUsd })}
                />
              </Field>
              <Field label="Runs one agent session may start" hint="Finished and cancelled runs still count." group>
                <Input
                  label="Runs one agent session may start"
                  type="number"
                  min={1}
                  value={form()!.startsPerSession}
                  onInput={(startsPerSession) => patch({ startsPerSession })}
                />
              </Field>
            </Stack>
          </Show>
        </Show>
      </ModalBody>
      <ModalActions>
        <Show when={review()?.policy?.state === 'active'}>
          <ConfirmButton
            tone="danger"
            confirmLabel="Stop agents starting it?"
            disabled={busy()}
            onConfirm={() => void revoke()}
          >
            Stop allowing
          </ConfirmButton>
        </Show>
        <Button variant="ghost" onPress={props.onClose}>
          Close
        </Button>
        <Button
          variant="solid"
          disabled={!review() || !form() || busy()}
          busy={busy()}
          onPress={() => void approve(review()!)}
        >
          {review()?.policy?.state === 'active' ? 'Save approval' : 'Allow agent invocation'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
