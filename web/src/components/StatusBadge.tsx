import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import type { ComponentStatus } from '@shared/schemas/health';
import { Badge } from '@/components/ui/badge';

const look = {
  ok: { label: 'Ready', Icon: CircleCheck, className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  degraded: {
    label: 'Needs attention',
    Icon: CircleAlert,
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  down: { label: 'Not running', Icon: CircleX, className: 'bg-destructive/10 text-destructive' },
} as const;

export function StatusBadge({ status }: { status: ComponentStatus['status'] }) {
  const { label, Icon, className } = look[status];
  return (
    <Badge variant="secondary" className={className}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
