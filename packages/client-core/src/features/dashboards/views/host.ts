import { createContext, type Accessor } from 'solid-js'
import type { MeasureSample } from '@acorn/dashboards-core/render'

/** What a view needs from the client that draws it. A view imports no router, query client, or Node
 *  connection, so it draws in any client. Each member is optional. Without `openLink`, a link cell is a
 *  plain link the browser opens in a new tab. Without `measureHistory`, a stat draws no history trend. */
export type PanelViewHost = {
  /** Opens a link cell's address inside the client, and answers whether it did. False leaves the
   *  click to the browser. */
  openLink?: (url: string) => boolean
  /** A stat's recorded series for its history trend, read only while `enabled` is true. */
  measureHistory?: (panelId: Accessor<string | undefined>, enabled: Accessor<boolean>) => Accessor<MeasureSample[]>
}

export const PanelViewHostContext = createContext<PanelViewHost>({})
