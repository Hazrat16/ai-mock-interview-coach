# Spoken interview: turn latency (M7), 2026-10-30

Measured by `make e2e` (`e2e/voice-interview.spec.ts`): Google Chrome 156 with a fake microphone playing a Piper-spoken answer, against the real services (granite4:3b, whisper base.en, Piper ljspeech-medium), production build, i7-1355U on AC power. 2 questions, up to 1 follow-up each.

"Turn latency" = from the end of your answer (silence ran out, or Done) to the first sound of the interviewer's reply. The app splits it into: waiting for the last transcription, the interviewer's decision (saving the answer + LLM), and starting the reply's speech.

| Run | Answer → reply audio | Transcribe | Decide | Speak | Turn |
|---|---|---|---|---|---|
| 1 | **7.2 s** | 5 ms | 7.19 s | 12 ms | main → follow-up |
| 1 | 35 ms | 3 ms | 19 ms | 13 ms | follow-up → next question (limit reached, no model call) |
| 1 | 7.3 s | 3 ms | 7.29 s | 10 ms | main → follow-up |
| 2 | 7.4 s | – | – | – | main → follow-up |
| 3 | 8.0 s | 5 ms | 8.02 s | 8 ms | main → follow-up |
| 3 | 7.5 s | 4 ms | 7.50 s | 8 ms | main → follow-up |

**Result: 7-8 s when the interviewer decides on a follow-up; under 0.1 s otherwise.** Almost all of it is the LLM decision (as measured in M3). Transcription costs nothing extra because each speech segment is transcribed while you are still talking; the reply starts instantly because its first sentence ("Thank you.") is pre-synthesized. The end-of-answer silence (4 s by default) comes before this and is not included.

Other results from the same runs:
- Speech recognition of the fake answer: 0-4.5% WER.
- Every request from the page went to 127.0.0.1 (asserted by the test).
- The microphone is closed while the interviewer speaks (asserted: no "Recording" indicator).
- Microphone permission denied: a clear message, and the interview can start with typed answers (`e2e/mic-denied.spec.ts`).

## Interviewer decision: field order (prompt v2)
The first e2e runs never got a follow-up, even for a vague answer. Probing granite directly (5 behavioral questions, the same vague answer): it rated the answer "weak", wrote "without a concrete example" in its summary, and still chose "next" for 3 of 5. The JSON schema made it choose `action` before writing `summary` and `quality_signal`.

Fix (prompt version 2): the fields are generated in the order summary → quality_signal → action → follow_up, and the prompt says a weak answer, or one without a concrete example, gets a follow-up.

| | Follow-up chosen, vague answer | Follow-up chosen, good STAR answer |
|---|---|---|
| v1 (action first) | 2/5 | – |
| v2 (judge first) | **5/5** | 2/5 (both rated "ok", sensible deeper questions) |

When the model's follow-up only re-asks the main question ("Can you give a specific example of <the main question>?", rejected by the repeat guard) and the answer was weak, the interviewer now asks a fixed neutral probe instead: "Could you walk me through one specific example, and what you did yourself?"

## Notes for later
- M8 (evaluation) runs after the interview, so it does not add to turn latency.
- If 7-8 s feels long in practice, options: a shorter decision prompt, `num_predict` below 200, or playing the acknowledgment while the model decides.
