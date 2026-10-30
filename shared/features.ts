/**
 * Scoring is off for now: speech-to-text still mishears technical terms, so scores of the transcripts are not
 * fair, and the M9 pilot showed qwen's scores are not calibrated yet (docs/benchmarks/calibration-2026-10-30-*).
 * Off: after an interview only the interview-ready answer is written (~40 s per question instead of 2-4 min),
 * and the report shows it with the key points. On: full rubric evaluations with scores, as in M8.
 */
export const SCORING = false;
