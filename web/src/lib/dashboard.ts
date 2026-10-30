import { useEffect, useState } from 'react';
import { type Dashboard, dashboardSchema } from '@shared/schemas/history';
import { getJson } from './api';

/** The dashboard numbers (Dashboard and Progress pages). */
export function useDashboard() {
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    getJson('/api/dashboard', dashboardSchema)
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  return { data, error };
}

/** "web_fundamentals" → "web fundamentals". */
export const topicLabel = (tag: string) => tag.replace(/_/g, ' ');

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Chart labels: the day, plus the time where several interviews share a day. */
export function chartLabels(dates: string[]) {
  const days = dates.map(shortDate);
  return dates.map((d, i) =>
    days.indexOf(days[i]!) !== days.lastIndexOf(days[i]!)
      ? `${days[i]} ${new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : days[i]!,
  );
}
