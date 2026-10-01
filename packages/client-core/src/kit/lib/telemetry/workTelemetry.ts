// The kit reports work through a host-installed callback, just like contribution errors.
// No collector dependency or content crosses this seam. Sandboxed kits remain inert by default.
type WorkTelemetry = <T>(name: string, run: () => T, sizes?: Record<string, number>) => T
let report: WorkTelemetry | null = null
export const setWorkTelemetry = (next: WorkTelemetry | null): void => { report = next }
export const measureWork: WorkTelemetry = (name, run, sizes) => report ? report(name, run, sizes) : run()
