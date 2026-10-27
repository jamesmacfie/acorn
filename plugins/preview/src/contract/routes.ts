// The task's app through its Node (docs/plugins/plugin-api.md § Loopback routes), spelled once. It's here, not in
// a client library, because a library can't name a plugin's route: the desktop's helper passes it to custody for a
// remote Node's preview (docs/shell/bridge-and-broker.md § Previews).
export const previewProxyRoute = (taskId: string): string => `/v1/p/preview/tasks/${encodeURIComponent(taskId)}/proxy`
