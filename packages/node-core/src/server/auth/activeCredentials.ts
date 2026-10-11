// Which task credentials are live (docs/security/credentials.md § Revoking a credential). Every task
// token carries a random id. The Node's credential files add an id when they mint a token, and drop it
// when its child ends or its session is removed. Authentication refuses a task token whose id isn't
// here, so a copied token stops working when its owner goes, not up to 48 hours later.
//
// Memory only. After a restart the live ids are the ones in the credential files the Node renews, so a
// released child's token, whose file is deleted, never comes back.
export class ActiveCredentials {
  readonly #ids = new Set<string>()
  isActive(id: string | undefined): boolean {
    return !!id && this.#ids.has(id)
  }
  activate(id: string): void {
    this.#ids.add(id)
  }
  revoke(id: string | undefined): void {
    if (id) this.#ids.delete(id)
  }
}
