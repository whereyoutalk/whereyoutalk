# Runtime selection

The active runtime uses only Nemotron 3.5 ASR Streaming 0.6B for Korean
transcription on the local CUDA GPU.

Speaker presentation is deterministic for the two-person demo: completed
utterances alternate between person 1 and person 2. No voice embedding or actual
speaker-identification model is active.

This makes the A → B → A presentation stable, but it depends on each participant
speaking exactly one completed utterance per turn. Overlapping speech or an
unexpected endpoint split can shift the sequence.
