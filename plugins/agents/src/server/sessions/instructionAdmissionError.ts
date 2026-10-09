export class InstructionAdmissionError extends Error {
  constructor(readonly code: 'instruction_review_required' | 'instruction_scan_incomplete' | 'instruction_hidden_characters', message: string) {
    super(message)
    this.name = 'InstructionAdmissionError'
  }
}
