import { useEffect, useState } from 'react';
import { type Dashboard, dashboardSchema } from '@shared/schemas/history';
import { TAXONOMY } from '@shared/taxonomy';
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

// The first family's label wins (software engineering's "Databases", not data's "Databases and SQL").
const SKILL_LABELS = new Map<string, string>();
for (const groups of Object.values(TAXONOMY))
  for (const g of groups) for (const s of g.skills) if (!SKILL_LABELS.has(s.key)) SKILL_LABELS.set(s.key, s.label);

/** The skill's name from the taxonomy ("api_design" → "API design"), else the tag in words. */
export const topicLabel = (tag: string) => {
  const words = tag.replace(/_/g, ' ');
  return SKILL_LABELS.get(tag) ?? words.charAt(0).toUpperCase() + words.slice(1);
};

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
