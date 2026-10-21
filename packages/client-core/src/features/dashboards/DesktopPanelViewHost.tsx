import type { JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { openInAppUrl } from '../../host/registries/panes/contentLinks'
import { activeTaskId } from '../tasks/tasks'
import { createMeasureHistory } from './history'
import { PanelViewHostContext } from './views/host'

/** The desktop's panel view host, mounted once inside the router around the whole shell. A link cell
 *  opens in Acorn when Acorn has a surface for its address, and a stat reads its history trend from
 *  the Node. Without it, the views fall back silently, so a missing provider shows no error. */
export default function DesktopPanelViewHost(props: { children: JSX.Element }) {
  const navigate = useNavigate()
  return (
    <PanelViewHostContext.Provider
      value={{
        openLink: (url) => openInAppUrl(url, { taskId: activeTaskId(), prefer: 'route', navigate }),
        measureHistory: createMeasureHistory,
      }}
    >
      {props.children}
    </PanelViewHostContext.Provider>
  )
}
