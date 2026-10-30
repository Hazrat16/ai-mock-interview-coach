import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fieldClass } from '@/lib/styles';

/**
 * A button for an action that overwrites or deletes data: it opens a short panel where the confirmation word
 * must be typed before the action runs (R14).
 */
export function ConfirmAction(props: {
  label: string;
  /** What will happen, in plain words. */
  warning: React.ReactNode;
  word: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
  variant?: 'outline' | 'destructive';
  size?: 'sm' | 'default';
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();

  if (!open)
    return (
      <Button variant={props.variant ?? 'outline'} size={props.size} onClick={() => setOpen(true)}>
        {props.label}
      </Button>
    );
  const close = () => {
    setOpen(false);
    setTyped('');
  };
  return (
    <div className="w-full space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="group">
      <div className="text-sm">{props.warning}</div>
      <label htmlFor={id} className="block text-sm font-medium">
        Type {props.word} to confirm
      </label>
      <input
        id={id}
        className={fieldClass}
        value={typed}
        autoComplete="off"
        autoFocus
        onChange={(e) => setTyped(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={typed !== props.word || busy}
          onClick={() => {
            setBusy(true);
            void props.onConfirm().finally(() => {
              setBusy(false);
              close();
            });
          }}
        >
          {busy ? props.busyLabel : props.label}
        </Button>
        <Button variant="outline" size="sm" onClick={close} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
