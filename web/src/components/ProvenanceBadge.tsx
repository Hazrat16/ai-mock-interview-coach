import { CircleCheck, Sparkles } from 'lucide-react';
import { type Provenance, provenanceLabel } from '@shared/schemas/provenance';
import { Badge } from '@/components/ui/badge';

/** Where a company question or note came from (R23): yours, with source and date, or a model prediction. */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const verified = provenance.kind === 'verified';
  return (
    <Badge
      variant="secondary"
      className={`h-auto whitespace-normal text-left ${
        verified
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
      }`}
    >
      {verified ? <CircleCheck aria-hidden /> : <Sparkles aria-hidden />}
      {provenanceLabel(provenance)}
    </Badge>
  );
}
