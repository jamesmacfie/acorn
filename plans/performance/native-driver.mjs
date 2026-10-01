// Deadlines for the owned performance fixture, without changing the production automation driver.
import { WebDriverClient } from '../../apps/desktop/scripts/agent/webdriver.mjs'

export class PerformanceDriver extends WebDriverClient {
  async request(method, path, body) {
    const response = await fetch(`${this.endpoint}${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const payload = await response.json()
    if (!response.ok || payload?.value?.error) {
      throw new Error(`Performance driver ${method} failed: ${response.status}`)
    }
    return payload.value
  }
}
