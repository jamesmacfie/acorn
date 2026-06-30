// Typed accessor for the preload's `window.acorn.terminal` bridge (vNext §5). The global is declared
// here so anything importing it (App's flag check, TerminalPanel) sees the same shape.
import type { CreateOpts, RepoPath, RepoPathResult, ServerMsg, TerminalProfile, TerminalSession, WorktreeResult } from '../../../shared/terminal'

export type TerminalApi = {
  list(): Promise<TerminalSession[]>
  profiles(): Promise<TerminalProfile[]>
  create(opts: CreateOpts): Promise<TerminalSession>
  kill(id: string): Promise<boolean>
  interrupt(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  write(id: string, data: string): void
  onStatus(cb: () => void): () => void
  attach(id: string, on: (m: ServerMsg) => void): () => void
  repoPath: {
    get(owner: string, repo: string): Promise<RepoPath | null>
    set(owner: string, repo: string, path: string): Promise<RepoPathResult>
  }
  worktree: {
    ensure(owner: string, repo: string, number: number): Promise<WorktreeResult>
    remove(owner: string, repo: string, path: string, force: boolean): Promise<WorktreeResult>
  }
}

declare global {
  interface Window {
    acorn?: { desktop?: boolean; platform?: string; terminal?: TerminalApi }
  }
}

export const terminalApi = (): TerminalApi | null => window.acorn?.terminal ?? null
