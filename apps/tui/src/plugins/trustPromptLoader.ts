import { createSignal, type Component } from 'solid-js'

export const [trustPromptComponent, setTrustPromptComponent] = createSignal<Component | null>(null)
