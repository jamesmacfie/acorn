import type { PluginBridgeTelemetryRecord } from '@acorn/protocol/plugin/bridge.ts'
import type { AcornBridge, PluginTelemetryAttrs } from './bridgeTypes'

export function createBridgeTelemetry(port: MessagePort): Pick<AcornBridge, 'telemetry' | 'log'> {
  // Telemetry has no request id or reply. A closed port cannot make the plugin's work fail.
  const emit = (record: PluginBridgeTelemetryRecord): void => {
    try {
      port.postMessage({ kind: 'telemetry', record })
    } catch {
      // The surface is gone, so there is nobody to tell.
    }
  }

  const span = (name: string, attrs?: PluginTelemetryAttrs) => {
    const from = Date.now()
    let ended = false
    return {
      end: (status: 'ok' | 'error' = 'ok') => {
        if (ended) return
        ended = true
        emit({ type: 'span', name, durationMs: Date.now() - from, status, ...(attrs ? { attrs } : {}) })
      },
    }
  }

  // Collection is opt-in, so an author also sees log lines in the frame's own console.
  const line = (level: 'debug' | 'info' | 'warn' | 'error', message: string, attrs?: PluginTelemetryAttrs): void => {
    const text = attrs ? `${message} ${Object.entries(attrs).map(([key, value]) => `${key}=${String(value)}`).join(' ')}` : message
    if (level === 'error') console.error(text)
    else if (level === 'warn') console.warn(text)
    else console.log(text)
    emit({ type: 'log', level, message, ...(attrs ? { attrs } : {}) })
  }

  return {
    telemetry: {
      event: (name, attrs) => emit({ type: 'event', name, ...(attrs ? { attrs } : {}) }),
      count: (name, value = 1, attrs) => emit({ type: 'count', name, value, ...(attrs ? { attrs } : {}) }),
      gauge: (name, value, attrs) => emit({ type: 'gauge', name, value, ...(attrs ? { attrs } : {}) }),
      error: (error) => emit({ type: 'error', name: error.name, ...(error.message === undefined ? {} : { message: error.message }), ...(error.attrs ? { attrs: error.attrs } : {}) }),
      measure: <T,>(name: string, run: () => T, attrs?: PluginTelemetryAttrs): T => {
        const timing = span(name, attrs)
        let result: T
        try {
          result = run()
        } catch (error) {
          timing.end('error')
          throw error
        }
        // `finally` times a rejected promise and leaves its result untouched.
        if (result instanceof Promise) return result.finally(() => timing.end()) as T
        timing.end()
        return result
      },
      startSpan: span,
    },
    log: {
      debug: (message, attrs) => line('debug', message, attrs),
      info: (message, attrs) => line('info', message, attrs),
      warn: (message, attrs) => line('warn', message, attrs),
      error: (message, attrs) => line('error', message, attrs),
    },
  }
}
