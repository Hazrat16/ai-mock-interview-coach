// Skill coverage (M15, R24): how often you practised each skill of your job family's taxonomy, counted from the
// skill tags of the questions you answered, and how many bank questions exist for it.
import type { Coverage } from '@shared/schemas/coverage';
import type { InterviewConfig } from '@shared/schemas/interview';
import { TAXONOMY } from '@shared/taxonomy';
import type { Db } from '../connection';

const counts = (rows: { tag: string; n: number }[]) => new Map(rows.map((r) => [r.tag, r.n]));

/** Answered main questions per skill tag, across all your interviews. */
export function practicedSkills(db: Db): Map<string, number> {
  return counts(
    db
      .prepare(
        `SELECT tag.value AS tag, COUNT(*) AS n
         FROM turns t JOIN answers a ON a.turn_id = t.id JOIN sessions s ON s.id = t.session_id
           JOIN questions q ON q.id = t.question_id, json_each(q.skill_tags_json) AS tag
         WHERE t.kind = 'main' AND s.status != 'planned' AND a.transcript != ''
         GROUP BY tag.value`,
      )
      .all() as { tag: string; n: number }[],
  );
}

export function coverage(db: Db, family: InterviewConfig['jobFamily']): Coverage {
  const practiced = practicedSkills(db);
  const bank = counts(
    db
      .prepare(
        `SELECT tag.value AS tag, COUNT(*) AS n FROM questions q, json_each(q.skill_tags_json) AS tag
         WHERE q.source IN ('seed', 'generated') AND (q.job_family IS NULL OR q.job_family = ?)
         GROUP BY tag.value`,
      )
      .all(family) as { tag: string; n: number }[],
  );
  return {
    family,
    groups: TAXONOMY[family].map((g) => ({
      name: g.name,
      skills: g.skills.map((x) => ({
        ...x,
        practiced: practiced.get(x.key) ?? 0,
        bankQuestions: bank.get(x.key) ?? 0,
      })),
    })),
  };
}
