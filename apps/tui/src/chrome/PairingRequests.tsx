/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, onCleanup } from 'solid-js'
import { toast } from '@acorn/client-core/features/notifications'
import { askerLine, createPairingRequests, denyAdvice } from '@acorn/client-core/host/trust/pairingRequestModel.ts'
import { activeConfirmation, confirmAction, finishConfirmation } from './confirmStore'

/** The owner's side of pairing by approval in the terminal (docs/api-reference/transport.md § Pairing by
 *  approval). It draws nothing of its own: the question goes through the shell's confirmation, whose caret
 *  starts on Cancel, so Enter pressed out of habit denies the request. The model the desktop's dialog uses
 *  decides when there is a request and what answering it does. */
export function PairingRequests() {
  const { asking, answer, error, close } = createPairingRequests()

  createEffect(() => {
    const current = asking()
    if (!current) return
    const question = {
      title: 'Allow a new client?',
      goes: `${askerLine(current)} Allow it only if it shows these words: ${current.request.phrase}`,
      stays: denyAdvice(current.request),
      actionLabel: 'Allow',
    }
    void confirmAction(question).then(async (allowed) => {
      // The request may have ended or been replaced while the question was open, and answering it then
      // could only fail.
      if (asking()?.request.id !== current.request.id) return
      await answer(allowed ? 'allow' : 'deny')
      if (error()) {
        toast(error())
        close()
      }
    })
    // The request ended with its question still open, so take the question down without answering.
    onCleanup(() => {
      if (activeConfirmation() === question) finishConfirmation(false)
    })
  })

  return null
}
