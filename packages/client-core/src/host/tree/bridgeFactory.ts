import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import { createFrameBridge } from '../frames/broker'
import { createFrameServices, type FrameServiceHost, type PluginFrameProps } from '../frames/frameServices'

/** Construct outside a component's lexical scope: a legacy context may survive its first region,
 * but must retain only its immutable services, rather than that region's props, container or owner. */
export function createTreeBridgeFactory(
  props: Pick<PluginFrameProps, 'binding' | 'hash' | 'document'>,
  host: Omit<FrameServiceHost, 'frameHasFocus'>,
  context: PluginFrameContext,
  refused: (reason: string) => void,
) {
  return (port: MessagePort, frameHasFocus: () => boolean, legacyContext = context, authorize?: () => boolean) => createFrameBridge({
    port,
    binding: props.binding,
    services: createFrameServices(props, { ...host, frameHasFocus }),
    context: legacyContext,
    ...(authorize ? { authorize } : {}),
    onMisbehaving: (reason) => refused(`misbehaved on the bridge: ${reason}`),
  })
}
