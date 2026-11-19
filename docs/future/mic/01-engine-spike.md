# Phase 1: pick the engine by measuring it

Date: November 19, 2026. Status: proposed. Depends on nothing.

## Goal

Find out whether a local engine is close enough to Voice Type before building anything. This phase
writes no Acorn code. It produces a table of numbers and one decision.

## Steps

1. Record 10 dictations of the kind you give agents, 5 to 30 s each, as 16 kHz mono WAV. Include
   project words such as pnpm, Tauri, worktree, Drizzle, and a task or file name.
2. Dictate the same 10 into Voice Type and save what it typed. That is the reference.
3. Run each candidate on the same files, with the model already loaded, and time from the end of the
   audio to the text:
   - sherpa-onnx offline WebSocket server, Parakeet TDT 0.6B v2 int8.
   - sherpa-onnx with Parakeet v3, for the multilingual case.
   - transcribe.cpp `transcribe-cli` with a Parakeet GGUF on Metal. Subtract the model load, because
     a real build keeps it resident.
   - FluidAudio's CLI with Parakeet v2 on the Neural Engine.
4. Count word errors against what you meant to say, not against Voice Type.
5. If the Node sometimes runs on a Linux machine, such as the hermes-acorn VM, repeat the
   sherpa-onnx run there.

Keep the recordings, the scripts, and the binaries outside the repository, for example under
`~/.cache/acorn-voice-spike`.

## Results

| Engine and model | Median time to text, 10 s clip | Word errors in 10 clips | Notes |
| --- | --- | --- | --- |
| Voice Type | Not measured | Not measured | |
| sherpa-onnx, Parakeet v2 int8 | Not measured | Not measured | |
| sherpa-onnx, Parakeet v3 int8 | Not measured | Not measured | |
| transcribe.cpp, Parakeet GGUF, Metal | Not measured | Not measured | |
| FluidAudio, Parakeet v2 | Not measured | Not measured | |

## Decision rule

- Choose the simplest engine within 150 ms and two word errors of the best one. sherpa-onnx wins
  ties, because it runs on every Node platform from one binary family.
- If nothing comes within 500 ms of the end of the audio on a 10 s clip, stop here. Talk to James
  before phase 4.
- Record the audio format the winner wants. Phase 4 fixes it in the contract.

## Verify before building

- Which sherpa-onnx release binaries are signed or notarized for macOS, and whether an unsigned one
  runs when Node downloads it. Files fetched by a non-browser process don't get the quarantine flag.
- The licence of each model file. Parakeet is CC-BY-4.0. Check the GGUF and ONNX conversions too.

## Checkpoint

Not run. Fill in the results table and the decision, with the date.
