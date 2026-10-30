import { z } from 'zod';

/**
 * Where company information comes from (R23). The app is offline, so it knows nothing current about a
 * company: everything is either yours (with its source and date) or a labelled prediction.
 */
export const provenanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verified'), source: z.string(), date: z.string() }),
  z.object({ kind: z.literal('generated') }),
]);
export type Provenance = z.infer<typeof provenanceSchema>;

export const GENERATED_LABEL = 'Generated prediction, not verified';
export const provenanceLabel = (p: Provenance) =>
  p.kind === 'verified' ? `Verified by you (${p.source}, ${p.date})` : GENERATED_LABEL;
