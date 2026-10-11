import { createEffect, createSignal, on, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, latestSignal, type Task } from '@acorn/plugin-api/client'
import { Alert, Button, ConfirmButton, Row, Rows, Stack, Text } from '@acorn/plugin-api/ui'
import type { OperationControlAction } from '../shared/api'
import { operationActions, operationKey, operationLabel, operationOptions, stageNames } from './operationClient'
import { watchWorktreeInventory } from './worktreeInvalidation'
import { openChangesTab } from './gitPane'

/** The task checkout's Git operation and unresolved paths, read from Git each time, with explicit controls.
 *  Selecting a file opens the three-way resolver; Changes still owns ordinary staging. */
export function OperationBanner(props: { task: Task; onResolve: (path: string, checkout: string) => void }) {
  const cache = useQueryClient()
  const state = createQuery(() => operationOptions(props.task.id))
  watchWorktreeInventory(() => void cache.invalidateQueries({ queryKey: operationKey(props.task.id) }))
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const control = latestSignal()
  createEffect(
    on(
      () => `${activeNodeId()}:${props.task.id}`,
      () => {
        control.abort()
        setBusy(false)
        setError('')
      },
      { defer: true },
    ),
  )
  const current = () => {
    const data = state.data
    return data?.taskId === props.task.id && (data.operation || data.conflicts.length) ? data : null
  }
  const run = async (action: OperationControlAction) => {
    const observed = current()
    if (!observed?.operation) return
    const signal = control.next(),
      queryKey = operationKey(observed.taskId)
    setBusy(true)
    setError('')
    try {
      const result = await operationActions.control(observed.taskId, action, {
        expectedPath: observed.checkout,
        operation: observed.operation,
      })
      if (result.state) cache.setQueryData(queryKey, result.state)
      else void cache.invalidateQueries({ queryKey })
      if (!signal.aborted) setError(result.ok ? '' : (result.error ?? 'Git refused the operation.'))
    } catch (cause) {
      void cache.invalidateQueries({ queryKey })
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  const resolve = (path: string) => {
    const observed = current()
    if (observed) props.onResolve(path, observed.checkout)
  }
  return (
    <Show when={current()}>
      {(observed) => {
        const kind = () => observed().operation
        const unresolved = () => observed().conflicts.length
        return (
          <Stack gap="row">
            <Alert tone="warn" title={kind() ? `${operationLabel[kind()!]} in progress` : 'Unresolved conflicts'}>
              {kind()
                ? `${observed().branch ?? 'Detached HEAD'} at ${observed().head?.slice(0, 12) ?? 'no commit'}${observed().source ? `, with ${observed().source!.slice(0, 12)}` : ''}. Select a file to resolve it here, or resolve it in Editor and stage it in Changes. Then continue.`
                : 'Git left conflicted files without an operation to continue, as a conflicted stash apply does. Select a file to resolve it here, or resolve it in Editor and stage it in Changes.'}
            </Alert>
            <Show when={unresolved()}>
              <Rows
                id={`git-conflicts:${activeNodeId()}:${props.task.id}`}
                ariaLabel="Conflicted files"
                items={observed().conflicts.map((entry) => ({ key: entry.path, label: entry.path }))}
                onActivate={resolve}
              >
                {(item, itemProps) => (
                  <Row item={itemProps} onPress={() => resolve(item.key)}>
                    <Text>{item.key}</Text>
                    <Text emphasis="muted">
                      {' '}
                      · {stageNames(observed().conflicts.find((entry) => entry.path === item.key)?.stages ?? [])}
                    </Text>
                  </Row>
                )}
              </Rows>
            </Show>
            <Button variant="ghost" onPress={() => openChangesTab(props.task.id)}>
              Stage in Changes
            </Button>
            <Show when={kind()}>
              <Button
                disabled={busy() || !!unresolved()}
                busy={busy()}
                onPress={() => void run('continue')}
                tip={unresolved() ? 'Stage every conflicted file in Changes first' : `git ${kind()} --continue`}
              >
                Continue
              </Button>
              <Show when={kind() !== 'merge'}>
                <Button variant="ghost" disabled={busy()} onPress={() => void run('skip')} tip={`git ${kind()} --skip`}>
                  Skip commit
                </Button>
              </Show>
              <ConfirmButton
                tone="danger"
                variant="ghost"
                confirmLabel={`Abort the ${kind()}?`}
                disabled={busy()}
                tip={`git ${kind()} --abort`}
                onConfirm={() => void run('abort')}
              >
                Abort
              </ConfirmButton>
            </Show>
            <Show when={error()}>
              <Alert tone="danger">{error()}</Alert>
            </Show>
            <Show when={state.error}>
              <Alert tone="muted">{String(state.error)} Showing the last observed state.</Alert>
            </Show>
          </Stack>
        )
      }}
    </Show>
  )
}
