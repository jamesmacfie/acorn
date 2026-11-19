// The core speech routes the agent composer calls (docs/agent-tools/speech-engines.md).

/** The largest recording the Node accepts, about five minutes of 16 kHz, 16-bit mono audio. */
export const SPEECH_AUDIO_MAX_BYTES = 10 * 1024 * 1024

export type SpeechEngineState = 'ready' | 'needs-setup' | 'preparing' | 'failed'

export type SpeechStatusResponse = {
  engine: {
    pluginId: string
    id: string
    label: string
    state: SpeechEngineState
    /** One line for the person, such as why the engine failed. */
    detail?: string
    /** The engine plugin's settings page, for **Set up voice input**. */
    settings?: string
  } | null
}

export type SpeechTranscribeResponse = { text: string }
