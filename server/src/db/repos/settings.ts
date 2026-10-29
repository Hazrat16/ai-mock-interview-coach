import { type Settings, type SettingsPatch, settingsSchema } from '@shared/schemas/settings';
import type { Env } from '../../env';
import { type Db, transaction } from '../connection';

export function defaultSettings(env: Env): Settings {
  return {
    interviewerModel: env.INTERVIEWER_MODEL,
    evaluatorModel: env.INTERVIEWER_MODEL,
    showTranscript: true,
    endOfAnswerSilenceSec: 4,
    defaultThinkingTimeSec: 10,
  };
}

/** Stored values over defaults. A stored value that no longer validates falls back to its default. */
export function getSettings(db: Db, defaults: Settings): Settings {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[];
  const merged: Record<string, unknown> = { ...defaults };
  for (const { key, value_json } of rows) {
    const field = settingsSchema.shape[key as keyof Settings];
    const parsed = field?.safeParse(JSON.parse(value_json));
    if (parsed?.success) merged[key] = parsed.data;
  }
  return settingsSchema.parse(merged);
}

export function updateSettings(db: Db, patch: SettingsPatch) {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  );
  const now = new Date().toISOString();
  transaction(db, () => {
    for (const [key, value] of Object.entries(patch)) upsert.run(key, JSON.stringify(value), now);
  });
}
