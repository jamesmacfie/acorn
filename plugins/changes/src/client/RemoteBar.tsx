import { Show } from 'solid-js'
import {
  Alert, Button, ConfirmButton, Icon, IconButton, Menu, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import type { ChangesModel } from './changesModel'
import { PUSH_ACTIONS_POINT, type PushActionsProps } from './extensionPoints'
import { primaryRemote, remoteCounts, type RemoteAction, type RemoteVerb } from './model'

// The strip between the file list and the commit editor: which branch this is, how far it is from its
// upstream, and one button whose label is the next thing to do. Above it, only while a merge or a
// rebase is mid-flight, a banner that says so and offers to undo it.
//
// The counts are text and the verb is a button. Zed makes the counts part of the button; keeping them
// apart means the label is only the verb, which is what the terminal projection needs when the row is
// 40 cells wide (docs/ui-design/every-node.md § Every node at 80 by 24).

/** What the primary button says. Publish and Push run the same git command; the label is the
 *  difference, because "publish" is what a branch with no upstream needs to hear. */
const LABEL: Record<RemoteVerb, string> = {
  publish: 'Publish',
  pull: 'Pull',
  push: 'Push',
  fetch: 'Fetch',
}

/** The button's tooltip: what the press does to this branch, with the command underneath. */
const TIP: Record<RemoteVerb, string> = {
  publish: 'Push this branch and set its upstream',
  pull: 'Fast-forward onto the upstream',
  push: 'Send the commits on this branch',
  fetch: 'Ask the remote what has moved',
}

/** The git command each verb runs, for the hint under the label. The one place a reader can see that
 *  Publish and Push are the same call, and that a bare Pull will not write a merge commit. */
const COMMAND: Record<Exclude<RemoteAction, 'abort'>, string> = {
  fetch: 'git fetch',
  pull: 'git pull --ff-only',
  rebase: 'git pull --rebase',
  push: 'git push --set-upstream origin HEAD',
  force: 'git push --force-with-lease --set-upstream origin HEAD',
}

/** The short counts in words, for their tip. None when there is no upstream to count against. */
const countsTip = (state: ReturnType<ChangesModel['status']>): string | undefined =>
  state.upstream == null ? undefined : `${state.behind ?? 0} behind, ${state.ahead ?? 0} ahead`

/** Which verb the primary button runs. Publish and Push are one call
 *  (../server/localDiff.ts § pushArgs). Never `abort`, which only the banner offers. */
const actionFor = (verb: RemoteVerb): Exclude<RemoteAction, 'abort'> => (verb === 'publish' ? 'push' : verb)

/** The banner for a merge or rebase that has stopped part way.
 *
 *  Drawn from `status().operation`, which is a filesystem check beside the status read, so a rebase
 *  somebody started in the terminal shows here too. Abort is the only verb offered: resolving is the
 *  editor's job or the terminal's, and `rebase --continue` needs every conflict staged first, so a
 *  button for it would fail until then, which is a button that lies. */
function OperationBanner(props: { model: ChangesModel }) {
  const operation = () => props.model.status().operation
  return (
    <Show when={operation()}>
      {(kind) => (
        <Alert
          tone="warn"
          title={kind() === 'rebase' ? 'Rebase in progress' : 'Merge in progress'}
          actions={
            <ConfirmButton
              variant="bare"
              size="sm"
              confirmLabel="Abort?"
              tip={`Undo the ${kind()} and put the branch back`}
              tipSub={`git ${kind()} --abort`}
              disabled={props.model.remoteBusy()}
              onConfirm={() => void props.model.remote('abort')}
            >
              Abort
            </ConfirmButton>
          }
        >
          Resolve the conflicts in the editor or a terminal, then commit. Or abort and start again.
        </Alert>
      )}
    </Show>
  )
}

/** Fetch, the two pulls, and the two pushes.
 *
 *  No heading above the run. Each label says the whole verb instead.
 *
 *  Force push sits last, below a rule, as every destructive item does (docs/ui-design/interaction.md § Menus and
 *  right-click). It is a `Menu.Item` with `confirm`, on the pattern the row's Discard set (./fileTools.tsx):
 *  the armed label is the prompt on every host, and a dialog was refused by the programme's
 *  decisions table. */
function RemoteMenu(props: { model: ChangesModel }) {
  const model = () => props.model
  const run = (action: RemoteAction) => void model().remote(action)
  return (
    <Menu
      ariaLabel="Remote actions"
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <IconButton
          icon="chevron-down"
          label="Remote actions"
          tip="More sync actions"
          opens="menu"
          expanded={open()}
          disabled={model().remoteBusy()}
          onPress={toggle}
        />
      )}
    >
      {(menu) => (
        <>
          <Menu.Item context={menu} title={COMMAND.fetch} onSelect={() => run('fetch')}>Fetch</Menu.Item>
          <Menu.Item context={menu} title={`${COMMAND.pull} — refused on a diverged branch`} onSelect={() => run('pull')}>
            Pull
          </Menu.Item>
          <Menu.Item context={menu} title={COMMAND.rebase} onSelect={() => run('rebase')}>Pull with rebase</Menu.Item>
          <Menu.Item context={menu} title={COMMAND.push} onSelect={() => run('push')}>Push</Menu.Item>
          <Menu.Separator />
          <Menu.Item
            context={menu}
            tone="danger"
            confirm="Force push?"
            title={`${COMMAND.force} — replaces the upstream with this branch`}
            onSelect={() => run('force')}
          >
            Force push
          </Menu.Item>
        </>
      )}
    </Menu>
  )
}

/** The banner, the bar, and the `changes:push-actions` slot under it.
 *
 *  Mounted at the top of the footer, above the commit editor, because the order top to bottom is what
 *  happens in order: see where you are, land the commit, then send it (docs/panes/layout.md § Layout model).
 */
export function RemoteBar(props: { model: ChangesModel }) {
  const model = () => props.model
  const status = () => model().status()
  const verb = () => primaryRemote(status())
  // Disabled rather than hidden while an operation is in flight. The row keeps its shape, and the
  // tooltip is where the reason goes; a control that vanishes leaves a reader wondering what moved.
  const stalled = () => status().operation != null
  return (
    <>
      <OperationBanner model={model()} />
      <Toolbar size="sm" ariaLabel="Branch">
        <Icon name="git-branch" title="Branch" />
        {/* The branch alone. The top bar names the project on a task, and the branch is the one fact
            this bar exists to show, so nothing before it takes its width. */}
        <Text>{status().branch ?? 'No branch (detached)'}</Text>
        <Toolbar.Spacer />
        <Show when={remoteCounts(status())}>
          {(counts) => <Text emphasis="muted" tip={countsTip(status())}>{counts()}</Text>}
        </Show>
        <Button
          size="sm"
          busy={model().remoteBusy()}
          disabled={stalled()}
          tip={stalled() ? 'Finish or abort the operation above first' : TIP[verb()]}
          tipSub={COMMAND[actionFor(verb())]}
          onPress={() => void model().remote(actionFor(verb()))}
        >
          {LABEL[verb()]}
        </Button>
        <RemoteMenu model={model()} />
      </Toolbar>
      {/* What another plugin does once the branch is on its remote, between the bar and the editor:
          the GitHub plugin's "Open pull request" is the one filler today (docs/plugins/remote-points.md
          § Remote points).

          No children, so an unfilled point draws nothing and takes no space. With no contributor
          installed the footer is exactly the height it was before this slot existed, which is the
          property that let the bar reserve the space in phase 3 without reserving any pixels.

          The props are the five facts the bar already reads. A contributor needing anything else asks
          its own side: this plugin does not know what is downstream of a push and does not learn. */}
      <Slot
        point={PUSH_ACTIONS_POINT}
        taskId={model().task.id}
        projectId={model().task.projectId}
        props={(): PushActionsProps => ({
          taskId: model().task.id,
          projectId: model().task.projectId,
          branch: status().branch,
          upstream: status().upstream,
          ahead: status().ahead,
        })}
      />
    </>
  )
}
