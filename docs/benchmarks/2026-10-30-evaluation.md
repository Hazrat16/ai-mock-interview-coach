# Answer evaluation (M8), 2026-10-30

Evaluator **qwen3.5:4b** (fallback granite4:3b), temperature 0.1, seed 42, `num_ctx` 8192, 8 threads, i7-1355U on AC power. Prompt version 1, rubrics version 1 (`server/src/evaluation/rubrics/`). Re-run with `make eval-smoke`.

## What is evaluated
One evaluation per answered **main question, together with its follow-ups**: the follow-up answers complete the main answer, and scoring a follow-up answer alone against the full rubric would be unfair. Stored against the main answer (`evaluations.answer_id`), queued per question, one at a time, after the interview ends.

The model scores each criterion 0-4 (evidence quotes → rationale → score, in that order) and writes the feedback. **Code** computes the overall score (Σ weight × score/4 × 100), checks every quote against the transcript, and adds the rubric's anchor text for each score.

## One real evaluation per interview type (`make eval-smoke`)
Middling spoken answers (some substance, clear gaps):

| Type | Question | Score | Time | Valid on 1st try | Quotes found |
|---|---|---|---|---|---|
| Behavioral | Disagreed with a teammate (+ 1 follow-up) | 50 | 135 s | yes | 7/7 |
| Technical | How does an index speed up a query? | 57 | 110 s | yes | 8/8 |
| Coding | Two numbers adding up to a target | 56 | 105 s | yes | 4/4 |
| System design | URL shortener | 16 | 122 s | yes | 5/5 |
| Technical, wrong-topic answer (by mistake) | Typing a URL in a browser, answered about indexes | 0 | 97 s | yes | 0/0 |

The rationales match the anchors: e.g. system design 16 because "jumps straight into components without requirements"; technical 57 with the bank's missing expected points named (composite order, storage cost). The accidental wrong-topic answer scored 0 with "answered about database indexing instead of DNS/TCP/HTTP": the evaluator checks relevance.

**Time per answer: 95-135 s** (consistent with M3). A 3-question interview is evaluated in about 5-7 minutes in the background; the report fills in as each finishes.

## In the full spoken e2e test (`make e2e`)
Interview → View report → both evaluations done after 216 s (116 s and 99 s), report shows scores, the delivery panel and the disclaimer.

## Calibration finding for M9
A vague non-answer ("I usually just work it out with the team. We talk about it and then we find something that works for everyone.", given twice, to the main question and to the follow-up) scored **0 on every criterion**. The model treated the generic sentence as no evidence at all. By the anchors a fairer result is about 11/100 (relevance 1 "loosely related", personal contribution 1 "vague personal role"). The ranking is right (a non-answer scores lowest) but the bottom of the scale is too harsh. M9's consistency harness tunes the anchors against a graded answer set; this example goes into it.

## Robustness (tested with a fake Ollama, `server/test/integration/evaluations.test.ts`)
- Out-of-range scores rejected by the schema → one repair attempt → fallback model.
- A failed evaluation shows "Retry evaluation"; other answers are unaffected.
- A job interrupted by a crash is re-queued at the next start.
- Ollama not running: jobs wait and retry every 30 s instead of failing.
- Evaluations pause while an interview is in progress (activity within 10 minutes), so they never compete with the live interviewer for the LLM.
