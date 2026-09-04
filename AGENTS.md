# Product

`누구말?` is a short accessibility prototype for Deaf and hard-of-hearing
people in multi-speaker, in-person conversations.

## Core flow

Browser microphone
→ local Korean streaming STT
→ completed utterances alternate between person 1 and person 2
→ spatial captions
→ person 1 stays left and person 2 stays right

## Runtime

- Frontend: dependency-free HTML, CSS, and JavaScript in `web/`
- Local inference: NVIDIA NeMo-Speech.cpp HTTP/WebSocket server
- ASR: `nvidia/nemotron-3.5-asr-streaming-0.6b`, language `ko-KR`
- GPU: CUDA device 0 when available
- No external model API
- Audio and transcripts must never be persisted

## Acceptance criteria

1. The microphone starts with one button.
2. Only Korean speech is transcribed.
3. The first completed utterance is person 1 and the next is person 2, repeating.
4. Person 1 is fixed left and person 2 is fixed right.
7. No audio, transcript, or mapping is persisted.
8. No audio is sent to an external API.
9. The UI stays usable when either local model server or the microphone is unavailable.

## Non-goals

- Physical sound direction estimation
- Speaker recognition across sessions
- Emotion recognition
- Login or database
- Perfect overlapping-speech handling
- Actual voice-based speaker identification
- More than two speakers

## Development rule

Prioritize a reliable demo over architecture. Do not add features outside the
acceptance criteria. Never invent participant observations or quotes.
