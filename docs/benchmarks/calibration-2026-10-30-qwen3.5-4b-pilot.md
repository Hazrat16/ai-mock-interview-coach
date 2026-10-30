# Scoring calibration pilot: qwen3.5:4b (2026-10-30), paused

**Status: M9 is paused.** Scores are hidden in the app (`SHOW_SCORES = false`) and scoring is not being tuned for now:
speech-to-text still mishears technical terms in real answers, so scores of the transcripts would not be fair anyway.
The interview and the interview-ready answers with key points do not depend on this. Resume with `make calibrate`
(results are cached); the full run (3 seeds, all 20 questions) takes about 7 hours.

## What the pilot showed

Two pilots, 2 questions per rubric × strong/medium/weak, one seed each, plus filler and misheard variants.

| Check | Prompt v2 | Prompt v3 | Target |
|---|---|---|---|
| Ordering strong > medium > weak | 6/8 | 7/8 (the 8th had a failed evaluation) | ≥ 90% |
| Inside expected band | 32% | 39% | ≥ 75% |
| Evidence quotes found in the answer | 98% | 96% | ≥ 95% |
| Fillers / misheard terms within 5 points | 4/9 | 3/10 | all |

- qwen3.5:4b ranks answers reliably, but its numbers are not calibrated: strong answers often get 100, some weak
  ones 0, medium technical answers 81-88.
- One run is sensitive to small wording changes: fillers moved scores by up to ±20, misheard terms cost 14-26 points
  even with the v2 rule to ignore them.
- Prompt v3 (pick the best-matching anchor; 0 only when nothing relates; 4 only when the whole anchor applies)
  moved vague answers off 0. Code safeguards from 08 §2 are in: a criterion with no quote found in the answer is
  capped at 1; an answer under 20 words cannot score above 30.
- Open question for later: the strong band (75-95) may be better as 75-100, and the golden answers are not yet
  reviewed by you.

## Bugs found by the long runs (fixed; they affected the app too)

1. llama-server's prompt cache was allowed 8 GB inside the 7 GB Ollama container, so long evaluation runs were
   OOM-killed. Capped at 512 MB (`LLAMA_ARG_CACHE_RAM` in `compose.yaml`).
2. Node's `fetch` drops a response with no headers after 300 s; a slow non-streaming evaluation came back as
   "Ollama is not reachable", and the job runner re-queued it as if Ollama were down. The client now streams, so
   our own timeouts apply.

## Pilot v3 output

### Targets

| Check | Result | Target | |
|---|---|---|---|
| Ordering strong > medium > weak | 7/8 (88%) | ≥ 90% | ❌ |
| Inside expected band | 9/23 (39%) | ≥ 75% | ❌ |
| Evidence quotes found in the answer | 233/242 (96%) | ≥ 95% | ✅ |
| Fillers / misheard terms within 5 points | 3/10 | all | ❌ |

### Scores per question (mean over seeds; expected: strong 75–95, medium 45–70, weak 10–40)

| Rubric | Question | Strong | Medium | Weak |
|---|---|---|---|---|
| behavioral | beh-disagreement | **100** | 56 | **5** |
| behavioral | beh-mistake | 95 | **81** | **0** |
| coding | code-two-sum | 89 | **40** | 34 |
| coding | code-brackets | 84 | 56 | 13 |
| system_design | sd-url-shortener | **100** | – | 11 |
| system_design | sd-rate-limiter | **100** | **21** | **0** |
| technical | tech-race | **100** | **88** | **0** |
| technical | tech-index | **100** | **81** | 32 |

Bold: mean outside the expected band.

### Criterion scores (0–4, mean) per answer quality

| behavioral | relevance | star_structure | personal_contribution | results_impact | reflection |
|---|---|---|---|---|---|
| strong | 4.0 | 4.0 | 4.0 | 3.5 | 4.0 |
| medium | 4.0 | 3.0 | 3.0 | 1.5 | 2.0 |
| weak | 0.0 | 0.0 | 0.0 | 0.5 | 0.0 |

| coding | problem_understanding | algorithm | complexity | edge_cases | code_quality |
|---|---|---|---|---|---|
| strong | 3.5 | 4.0 | 3.5 | 3.5 | 2.0 |
| medium | 2.0 | 3.5 | 2.0 | 0.0 | 0.0 |
| weak | 1.0 | 2.0 | 0.0 | 0.0 | 0.5 |

| system_design | requirements | architecture | data_storage | scalability | tradeoffs |
|---|---|---|---|---|---|
| strong | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| medium | 0.0 | 1.0 | 1.0 | 2.0 | 0.0 |
| weak | 0.0 | 0.5 | 0.5 | 0.0 | 0.0 |

| technical | correctness | depth | reasoning | tradeoffs | clarity |
|---|---|---|---|---|---|
| strong | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| medium | 4.0 | 2.5 | 3.5 | 2.5 | 4.0 |
| weak | 0.5 | 0.5 | 0.5 | 0.0 | 2.0 |

### Delivery independence (medium answer; same seed)

| Question | Variant | Clean | Variant | Difference |
|---|---|---|---|---|
| beh-disagreement | fillers | 56 | 68 | +12 |
| beh-disagreement | misheard | 56 | 41 | -15 |
| beh-mistake | fillers | 81 | 78 | -3 |
| code-two-sum | fillers | 40 | 49 | +9 |
| code-brackets | fillers | 56 | 56 | 0 |
| sd-rate-limiter | fillers | 21 | 41 | +20 |
| tech-race | fillers | 88 | 84 | -4 |
| tech-race | misheard | 88 | 74 | -14 |
| tech-index | fillers | 81 | 95 | +14 |
| tech-index | misheard | 81 | 55 | -26 |

Time per evaluation: mean 122 s, max 208 s (35 results).
