// The account plugin's routes on a Node, spelled once. The ticket route is here, not in a client
// library, because a library can't name a plugin's route: the app that has the plugin passes it to
// custody (docs/relay/accounts.md § Tickets).
export const accountRoute = (path: string): string => `/v1/p/account${path}`
export const ACCOUNT_TICKET_ROUTE = accountRoute('/tickets')
