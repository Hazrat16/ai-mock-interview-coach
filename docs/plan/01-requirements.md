# 01. Requirements Specification

Tiers:
- **MVP** = first working version: a complete audio interview with an evaluation report.
- **Important** = next improvements that make daily practice valuable.
- **Advanced** = later, optional, or experimental.

Milestone numbers refer to [07-roadmap.md](07-roadmap.md).

## Guiding constraints (apply to all features)

- C1. All inference (LLM, STT, TTS, VAD) runs on this machine. The app makes no outbound network requests at runtime.
- C2. No raw audio is kept by default. Audio is held only in memory until it is transcribed.
- C3. Scores are labeled as **practice scores** and never presented as a prediction of hiring outcomes.
- C4. Content quality is scored separately from delivery. Accent, speed, and filler words never affect content scores.
- C5. The live interview path favors speed. Deep analysis happens after the interview.

---

## MVP (Must-have)

### R1. Interview setup (M4)
Configure: job title, job family (e.g. Software Engineering, Data, Product, Design, Other), experience level (intern, junior, mid, senior, lead), interview type (HR, behavioral, technical, coding-verbal, system design), difficulty (easy, medium, hard), question count (1–15), target duration (informational), thinking time (0–60 s), follow-ups per question (0–2), and free-text custom instructions. Questions are chosen randomly from the local bank and are not repeated within a session.
- *Depends on:* R10 (storage), question bank seed.
- *Acceptance:* Saving a configuration and starting a session produces a session plan with N distinct questions that match the type, level, and difficulty filters. The same seed gives the same plan. Invalid input (e.g. 0 questions) is rejected with a clear message. If the bank has fewer matching questions than requested, the app says so and offers to generate the rest (R4).

### R2. Spoken interviewer, local TTS (M5)
The interviewer's text is synthesized locally and played through the browser.
- *Acceptance:* Every interviewer utterance is audible. Playback of a long utterance starts after its first sentence is synthesized, without waiting for the full text. If TTS fails, the text is shown on screen with a retry button and the interview can continue.

### R3. Microphone answer capture with local STT (M6, M7)
Explicit permission flow, a visible recording indicator, VAD-based speech detection, local transcription.
- *Acceptance:* The browser permission prompt appears only after you click "Enable microphone". A red "Recording" indicator is visible whenever the mic stream is live. Speech is transcribed locally with no network access. An empty or unintelligible transcript triggers "Sorry, I didn't catch that" up to 2 times, then offers a typed-answer fallback (recovery only).

### R4. Turn-taking and interview flow (M4 text-mode, M7 audio)
States: `intro → asking → thinking-time → listening → transcribing → deciding → (follow-up | next question) → … → closing`.
- *Acceptance:* An answer is finalized when you click **Done** or press Space, or after the configured end-of-answer silence (default 4 s) with a visible countdown that any speech cancels. Thinking-time silence never ends an answer. Follow-ups respect the per-question limit. The session ends after the last question with a spoken closing line.

### R5. Interview controls (M7)
Pause, resume, repeat question, skip question, end interview, transcript show/hide, and a status bar (Speaking / Listening / Transcribing / Thinking / Paused / Error).
- *Acceptance:* Every control is available by mouse and keyboard and works in every state where it makes sense. Pause stops TTS playback and releases the microphone. "End interview" asks for confirmation and saves everything recorded so far.

### R6. Contextual follow-ups (M4)
After each answer, a small LLM call returns JSON: `{action: "follow_up"|"next", follow_up?: string, ack: string}`.
- *Acceptance:* The JSON is validated. On invalid JSON or timeout the app falls back to `next` with a neutral acknowledgment, so the interview never stalls. Follow-ups refer to something you actually said.

### R7. Per-answer evaluation (M8)
Runs after the interview, queued per answer. Output: an overall score from 0–100 (computed in code from rubric criteria), criterion scores, quoted evidence, strengths, mistakes and missing concepts, improvement suggestions, a stronger example answer, and a recommended follow-up exercise.
- *Depends on:* R10, rubric definitions.
- *Acceptance:* Every evaluation passes schema validation, or is marked `failed` with a retry button. Evidence quotes are checked against the transcript, and quotes that are not found are flagged. Each report shows the rubric version and the model used.

### R8. Rubrics per interview type (M8)
Behavioral/HR: relevance, STAR structure, personal contribution, results and impact, reflection. Technical: correctness, depth, reasoning, trade-offs, communication clarity. Coding (verbal): problem understanding, algorithm correctness, complexity analysis, edge cases, code-quality reasoning. System design: requirements, architecture, data and storage, scalability and reliability, trade-offs.
- *Acceptance:* Each rubric has written anchors for every score level (0–4) and a weight per criterion. The weights sum to 1.

### R9. Session report (M8)
- *Acceptance:* Shows the full Q&A transcript, per-answer evaluations, the session average, separate delivery metrics (words per minute, long pauses), and the practice-score disclaimer.

### R10. Local persistence and delete (M2, M4)
- *Acceptance:* Sessions, turns, answers, and evaluations survive an app restart. Deleting a session removes all of its rows (cascade).

### R11. Settings and health (M1, M3)
Model selection, component status (Ollama, STT, TTS), voice, speech rate, end-of-answer silence.
- *Acceptance:* The settings page shows a green or red status for each local component with a fix hint. A missing model shows the exact `ollama pull` command.

---

## Important (next improvements)

| ID | Feature | Milestone | Depends on | Acceptance criteria |
|----|---------|-----------|------------|---------------------|
| R12 | **History**: list, search (full-text), filter by type, level, date, and score | M10 | R10 | Search finds words inside transcripts. Filters combine. Results open the report. |
| R13 | **Dashboard**: total interviews, average and recent scores, per-skill scores, score trend chart, recurring strengths and weaknesses | M10 | R7 | Numbers match the database (checked by a test). The chart renders with 0, 1, and many sessions. |
| R14 | **Export, backup, restore, delete-all** | M11 | R10 | Backup is a single file that restores to an identical state (row counts and checksums match). Restore warns before overwriting. Delete-all requires typing a confirmation word. |
| R15 | **Privacy controls**: delete transcripts only, optional audio retention (off by default) with auto-purge | M11 | R10 | With retention off, no audio files exist on disk after a session (checked by a test). |
| R16 | **Scoring consistency harness** | M9 | R7 | Golden-set run: same answer scored 3× has standard deviation ≤ 7 points; strong > medium > weak ordering holds in ≥ 90 % of triples. |
| R17 | **Adaptive difficulty** | M12 | R6 | The quick quality signal from the follow-up call moves the next question's difficulty up or down by one step at most. |
| R18 | **Retry mode** | M12 | R7 | Re-answer a past question. The report shows the previous and new score side by side. |
| R19 | **Weakness-focused practice** | M12 | R13 | Picks questions tagged with your 2–3 lowest skills (minimum 3 attempts each). Explains why each was chosen. |
| R20 | **Recommended exercises & practice goals** | M12 | R13 | Exercises come from evaluations. Goals have a target score and track progress. |
| R21 | **Job-description-based interview** (paste text) | M13 | R1 | Questions reference the JD's required skills. The JD is stored locally as a document. |
| R22 | **Resume-based interview** (PDF/TXT import, parsed locally) | M13 | R21 | PDF text is extracted locally with no network access. Questions reference resume projects. |

## Advanced (later)

| ID | Feature | Milestone | Notes / limitation |
|----|---------|-----------|--------------------|
| R23 | **Company-specific prep** | M14 | Uses only questions and notes you provide (with source and date). AI-generated "likely questions" are always labeled *Generated prediction, not verified*. Offline means no current company information. |
| R24 | **Assessment-based interview** (skill-gap mapping across a skill taxonomy) | M15 | Needs a skill taxonomy per job family and coverage logic. Built on R17. |
| R25 | Streaming STT with live partial captions | later | Possible with whisper.cpp streaming or sherpa-onnx, but costs CPU while the LLM is idle. Measure first. |
| R26 | Barge-in (interrupt the interviewer by speaking) | later | Needs reliable echo handling. Headphones only. Experimental. |
| R27 | Higher-quality voice (Kokoro-82M) | later | Apache-2.0. Adopt only if the TTS benchmark shows acceptable speed on this CPU. |
| R28 | Code editor panel for coding interviews | later | Conflicts with "no typing during the interview", so optional per session. |
| R29 | Voice commands ("repeat the question", "pause") | later | Keyword matching on short transcripts. |
| R30 | iGPU acceleration via Ollama Vulkan | later | Reported unstable on Intel iGPUs with ≥3B models. Benchmark only. |
| R31 | Desktop launcher (`.desktop` file), app-mode browser window | M15 | |

## Explicit non-goals
Multi-user accounts, authentication, cloud sync, Docker, Kubernetes, message brokers, analytics or telemetry, hiring predictions, video or camera.
