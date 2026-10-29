# Model decision (M3), 2026-10-29

Measured on the i7-1355U, plugged in, Ollama 0.40.13 in Docker (7 GB limit). Raw numbers: [2026-10-29-llm-bench.md](2026-10-29-llm-bench.md).

## Decision
| Role | Model | Why |
|------|-------|-----|
| Live interviewer (follow-up decision each turn) | **granite4:3b** | ~7.5–8 s per turn after the first; qwen3.5:4b took 18–28 s, too long a silence after each answer |
| Evaluation after the interview | **qwen3.5:4b** | Clearly better judgments and feedback; ~2 min per answer is acceptable offline |
| Fallback (evaluator failure, low memory) | granite4:3b | Smaller (2.7 GB vs 3.8 GB) and faster |
| CPU threads | **8** (`LLM_NUM_THREAD`) | qwen prompt reading 45 tok/s at 8 threads vs 25 at Ollama's default; granite generation 14 tok/s vs ~11 |

Only one model is held in memory (`OLLAMA_MAX_LOADED_MODELS=1`); switching costs a 5–9 s load.

## Speed (median of turns 2–3, i.e. after the first turn)
| | granite4:3b | qwen3.5:4b |
|---|---|---|
| Follow-up decision, default threads | 7.7 s | 27.6 s |
| Follow-up decision, 8 threads | 7.5–7.8 s | 19.5–21 s |
| Evaluation (~750-token rubric prompt, ~700–900 output tokens) | 62–107 s | 111–153 s |
| JSON valid on first try | 8/8 | 17/17 |
| Lowest free system RAM during the run | 3.4 GB | 2.3 GB |

granite benefits from Ollama reusing the cached start of the prompt (98–225 tok/s on repeat turns); qwen3.5 did not (25–46 tok/s every turn). Likely cause, not verified: qwen3.5's hybrid architecture prevents prefix-cache reuse in this Ollama version. Re-check after Ollama upgrades.

## Quality (same three answers, read by hand)
- **Weak answer** ("I don't really have conflicts… I said okay"):
  - granite follow-up repeated the main question ("Can you give a specific example of when you disagreed…").
  - qwen probed what was said ("Since you mentioned agreeing quickly, was there ever a situation where you felt strongly…").
- **Acknowledgments:** granite's were odd and repetitive ("Okay, let's see how this plays out." twice). qwen's were natural but sometimes praised the answer, against the rules.
- **Evaluation of the weak answer:**
  - granite was too generous (relevance 2/4) and gave a generic example answer.
  - qwen scored it accurately (relevance 1, results 0, reflection 0) with specific suggestions and a much stronger example answer.

## Follow-ups for later milestones
- **M4:** reject a follow-up too similar to the main question (code check), tighten the interviewer prompt, and use pre-recorded neutral acknowledgments if granite's stay odd. Re-measure live latency with the real prompt.
- **M8:** don't put hard `max` lengths on long text fields in the schema. Ollama enforces them while generating and cut qwen's exercise off mid-sentence at 300 characters. Ask for brevity in the prompt instead.
- **Option to revisit:** qwen3.5:4b for the live interview gives better follow-ups at ~20 s per turn. It's a setting (Settings → Interviewer model), so it can be tried in M7 with real audio.
