/** What the account service refused with, or `unavailable` when it didn't answer or isn't an account service.
 *  It sits apart from `account.ts` so a link can recognise it without loading the API's schemas. */
export class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(
      code === 'invalid_token'
        ? 'You’re signed out of your account.'
        : code === 'not_found'
          ? 'Your account doesn’t list that Node.'
          : 'Can’t reach your account.',
    )
  }
  /** The person has no session, or it ended. */
  get signedOut(): boolean {
    return this.code === 'invalid_token'
  }
}
