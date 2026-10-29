-- Initial schema. See docs/plan/06-database-schema.md. Never edit after commit; add a new migration instead.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  TEXT NOT NULL
);

CREATE TABLE model_configs (
  id           TEXT PRIMARY KEY,
  purpose      TEXT NOT NULL CHECK (purpose IN ('interviewer','evaluator','summarizer')),
  model_tag    TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)),
  is_active    INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_model_active ON model_configs(purpose) WHERE is_active = 1;

CREATE TABLE interview_configs (
  id                  TEXT PRIMARY KEY,
  name                TEXT,
  job_title           TEXT NOT NULL,
  job_family          TEXT NOT NULL,
  level               TEXT NOT NULL CHECK (level IN ('intern','junior','mid','senior','lead')),
  interview_type      TEXT NOT NULL CHECK (interview_type IN ('hr','behavioral','technical','coding','system_design')),
  difficulty          TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard','adaptive')),
  question_count      INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 15),
  duration_minutes    INTEGER,
  thinking_time_sec   INTEGER NOT NULL DEFAULT 10,
  follow_up_limit     INTEGER NOT NULL DEFAULT 1 CHECK (follow_up_limit BETWEEN 0 AND 2),
  custom_instructions TEXT,
  is_template         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('resume','job_description','company_notes')),
  title        TEXT NOT NULL,
  company      TEXT,
  content_text TEXT NOT NULL,
  summary      TEXT,
  provenance   TEXT NOT NULL CHECK (provenance IN ('user_provided','generated')),
  source_url   TEXT,
  source_date  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE questions (
  id                   TEXT PRIMARY KEY,
  text                 TEXT NOT NULL,
  text_hash            TEXT NOT NULL UNIQUE,
  interview_type       TEXT NOT NULL,
  job_family           TEXT,
  level_min            TEXT,
  level_max            TEXT,
  difficulty           TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  skill_tags_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skill_tags_json)),
  expected_points_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(expected_points_json)),
  source               TEXT NOT NULL CHECK (source IN ('seed','generated','user','company')),
  provenance           TEXT NOT NULL CHECK (provenance IN ('verified','user_provided','generated')),
  company              TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX ix_questions_filter ON questions(interview_type, difficulty, job_family);

CREATE TABLE sessions (
  id                   TEXT PRIMARY KEY,
  config_id            TEXT NOT NULL REFERENCES interview_configs(id),
  config_snapshot_json TEXT NOT NULL CHECK (json_valid(config_snapshot_json)),
  mode                 TEXT NOT NULL CHECK (mode IN ('random','retry','weakness','jd','resume','company','assessment')),
  status               TEXT NOT NULL CHECK (status IN ('planned','in_progress','paused','completed','abandoned')),
  plan_json            TEXT NOT NULL CHECK (json_valid(plan_json)),
  interviewer_model    TEXT NOT NULL,
  started_at           TEXT,
  ended_at             TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX ix_sessions_created ON sessions(created_at);
CREATE INDEX ix_sessions_status ON sessions(status);

CREATE TABLE session_documents (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, document_id)
);

CREATE TABLE turns (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('main','follow_up')),
  parent_turn_id     TEXT REFERENCES turns(id) ON DELETE CASCADE,
  question_id        TEXT REFERENCES questions(id) ON DELETE SET NULL,
  question_text      TEXT NOT NULL,
  difficulty         TEXT,
  retry_of_answer_id TEXT REFERENCES answers(id) ON DELETE SET NULL,
  summary            TEXT,
  quality_signal     TEXT CHECK (quality_signal IN ('weak','ok','strong')),
  asked_at           TEXT,
  UNIQUE (session_id, seq)
);

CREATE TABLE answers (
  id               TEXT PRIMARY KEY,
  turn_id          TEXT NOT NULL UNIQUE REFERENCES turns(id) ON DELETE CASCADE,
  transcript       TEXT NOT NULL,
  input_method     TEXT NOT NULL CHECK (input_method IN ('voice','typed_fallback')),
  stt_model        TEXT,
  avg_confidence   REAL,
  duration_ms      INTEGER,
  speaking_ms      INTEGER,
  word_count       INTEGER,
  delivery_json    TEXT CHECK (delivery_json IS NULL OR json_valid(delivery_json)),
  audio_path       TEXT,
  audio_expires_at TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE evaluations (
  id                         TEXT PRIMARY KEY,
  answer_id                  TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  status                     TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  rubric_key                 TEXT NOT NULL,
  rubric_version             INTEGER NOT NULL,
  prompt_version             INTEGER NOT NULL,
  model_tag                  TEXT NOT NULL,
  overall_score              INTEGER CHECK (overall_score BETWEEN 0 AND 100),
  result_json                TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  unsupported_evidence_count INTEGER NOT NULL DEFAULT 0,
  error                      TEXT,
  duration_ms                INTEGER,
  created_at                 TEXT NOT NULL
);
CREATE INDEX ix_eval_answer ON evaluations(answer_id, created_at);

CREATE TABLE evaluation_scores (
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_key TEXT NOT NULL,
  skill_key     TEXT NOT NULL,
  score         INTEGER NOT NULL CHECK (score BETWEEN 0 AND 4),
  weight        REAL NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  rationale     TEXT NOT NULL,
  PRIMARY KEY (evaluation_id, criterion_key)
);
CREATE INDEX ix_scores_skill ON evaluation_scores(skill_key);

CREATE TABLE skill_profiles (
  skill_key         TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  score_ema         REAL NOT NULL,
  attempts          INTEGER NOT NULL,
  last_practiced_at TEXT NOT NULL
);

CREATE TABLE learning_goals (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  skill_key    TEXT,
  target_score INTEGER CHECK (target_score BETWEEN 0 AND 100),
  due_date     TEXT,
  status       TEXT NOT NULL CHECK (status IN ('active','achieved','dropped')),
  created_at   TEXT NOT NULL
);

CREATE TABLE exercises (
  id                   TEXT PRIMARY KEY,
  skill_key            TEXT NOT NULL,
  prompt               TEXT NOT NULL,
  source_evaluation_id TEXT REFERENCES evaluations(id) ON DELETE SET NULL,
  status               TEXT NOT NULL CHECK (status IN ('todo','done','skipped')),
  created_at           TEXT NOT NULL,
  completed_at         TEXT
);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('evaluate_answer','summarize_document','rebuild_skills')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status       TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_jobs_status ON jobs(status, created_at);
