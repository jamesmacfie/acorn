import { Show } from 'solid-js'
import type { SettingsNavigate } from '../../host/registries/shell/settings'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { Alert, Button } from '../../kit/components/primitives'
import { openConnectionPage, SERVICES_PAGE } from '../settings/connections/connections'
import { INSTALLED_PAGE, openPluginPage } from '../settings/plugins/installed'
import type { FailureContext } from './planInputs'
import { describeSourceFailure, type SourceFix } from './sourceErrors'
import type { SourceFailure } from '@acorn/dashboards-core/plan.ts'

// A source's failure with the fix beside it, for the studio and the placed panel
// (docs/dashboards.md § Published panels). Every fix is host UI, because a loaded plugin can't open
// Settings: Review and Turn it on open the plugin's page, and Reconnect opens the account's.

const FIX_LABELS: Record<SourceFix, string> = {
  'choose-account': 'Choose an account', review: 'Review', reconnect: 'Reconnect…', 'turn-on': 'Turn it on', retry: 'Try again',
}

/** Settings' navigate, for a surface outside the settings layer: opens the layer on `target`. A layer
 *  that isn't open has nothing unsaved to ask about, so `opened` runs at once, and the page takes the
 *  request when it draws. */
const openSettingsAt: SettingsNavigate = (target, opened) => {
  clientEvents.emit('presentation:open-settings', { tab: target })
  opened?.()
}

/** A plugin's page in Settings, for About this source and the plugin fixes. */
export const openPluginSettings = (pluginId: string): void => openPluginPage(openSettingsAt, pluginId, 'node')

export default function SourceFailureAlert(props: {
  failure: SourceFailure
  context: FailureContext
  severity: 'error' | 'warning'
  /** Where Choose an account goes: the input's picker in the studio, the studio from a placed panel. */
  onChooseAccount?: () => void
  onRetry?: () => void
}) {
  const text = () => describeSourceFailure(props.failure, props.context.names)
  const run = (fix: SourceFix): void => {
    if (fix === 'choose-account') props.onChooseAccount?.()
    else if (fix === 'retry') props.onRetry?.()
    else if (fix === 'reconnect') {
      if (props.context.connection) openConnectionPage(openSettingsAt, props.context.connection, undefined)
      else openSettingsAt(SERVICES_PAGE)
    } else if (props.context.pluginId) openPluginSettings(props.context.pluginId)
    else openSettingsAt(INSTALLED_PAGE)
  }
  // A fix with nowhere to go here, such as Try again without a retry, isn't drawn.
  const fix = () => {
    const wanted = text().fix
    return wanted === 'choose-account' && !props.onChooseAccount || wanted === 'retry' && !props.onRetry ? undefined : wanted
  }
  return (
    <Alert tone={props.severity === 'error' ? 'warn' : 'muted'}
      actions={<Show when={fix()}>{wanted => <Button size="sm" onPress={() => run(wanted())}>{FIX_LABELS[wanted()]}</Button>}</Show>}>
      {text().message}
    </Alert>
  )
}
