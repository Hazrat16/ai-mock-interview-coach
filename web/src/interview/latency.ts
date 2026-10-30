// End-to-end turn latency: from the end of your spoken answer to the first audio of the interviewer's reply,
// split into its parts. Logged to the console and kept on window.__coachTurns for the e2e test (M7 acceptance).

export type TurnTiming = {
  /** Total: answer ended (silence/Done) → first audio of the next question. */
  totalMs: number;
  /** Waiting for the last speech-to-text results. */
  transcribeMs: number;
  /** Saving the answer and the interviewer's decision (LLM). */
  decideMs: number;
  /** Synthesizing and starting the first sentence of the reply. */
  speakMs: number;
};

const marks: { answerEnd?: number; submitted?: number; result?: number } = {};
const turns: TurnTiming[] = [];
(window as unknown as { __coachTurns: TurnTiming[] }).__coachTurns = turns;

/** `at`: when the answer ended (performance.now() clock); transcription may have finished later. */
export const markAnswerEnd = (at: number) => {
  marks.answerEnd = at;
  marks.submitted = marks.result = undefined;
};
export const markSubmitted = () => (marks.submitted = performance.now());
export const markResult = () => (marks.result = performance.now());

/** Call when the reply's first audio starts. Completes one measurement if a spoken answer preceded it. */
export function markReplyAudio() {
  const { answerEnd, submitted, result } = marks;
  if (answerEnd === undefined || submitted === undefined || result === undefined) return;
  const now = performance.now();
  const t: TurnTiming = {
    totalMs: Math.round(now - answerEnd),
    transcribeMs: Math.round(submitted - answerEnd),
    decideMs: Math.round(result - submitted),
    speakMs: Math.round(now - result),
  };
  turns.push(t);
  marks.answerEnd = undefined;
  console.info(
    `[turn] ${t.totalMs} ms from end of answer to reply audio ` +
      `(transcribe ${t.transcribeMs}, decide ${t.decideMs}, speak ${t.speakMs})`,
  );
}
