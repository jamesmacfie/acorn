import { Show } from 'solid-js'
import { Alert, DescriptionList, Text } from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor, AgentSession } from '../../contract/wire.ts'
import { sessionExecutable, sessionExecutableChanged } from '../../shared/sessionExecutable'

type Props = { session: AgentSession; provider?: AgentProviderDescriptor }

export function SessionExecutableNotice(props: Props) {
  return (
    <Show when={sessionExecutableChanged(props.session, props.provider)}>
      <Alert tone="warn" variant="banner" title="Agent executable changed">
        This session uses a different CLI path or version. Start a new session to use the installed CLI and reload its
        model list.
      </Alert>
    </Show>
  )
}

export default function SessionExecutableInfo(props: Props) {
  const executable = () => sessionExecutable(props.session)
  return (
    <>
      <Show when={!executable()}>
        <Text wrap tone="muted">
          The executable was not recorded. Details appear when this session reconnects.
        </Text>
      </Show>
      <DescriptionList size="sm">
        <DescriptionList.Item label="Session path">
          <Text emphasis="mono" wrap>
            {executable()?.path ?? 'Not recorded'}
          </Text>
        </DescriptionList.Item>
        <DescriptionList.Item label="Session version">{executable()?.version ?? 'Unknown'}</DescriptionList.Item>
        <Show when={props.provider?.executable}>
          {(path) => (
            <DescriptionList.Item label="Installed path">
              <Text emphasis="mono" wrap>
                {path()}
              </Text>
            </DescriptionList.Item>
          )}
        </Show>
        <Show when={props.provider?.executableVersion}>
          {(version) => <DescriptionList.Item label="Installed version">{version()}</DescriptionList.Item>}
        </Show>
      </DescriptionList>
    </>
  )
}
