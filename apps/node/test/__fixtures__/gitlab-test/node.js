// A code host that claims gitlab.test, with merge requests, and does nothing else
// (docs/plugins/code-hosts.md). The claim is the manifest's; the node half only has to run for the host
// to register it.
export default { name: 'gitlab-test', init() {} }
