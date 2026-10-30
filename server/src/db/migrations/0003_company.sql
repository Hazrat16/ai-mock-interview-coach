-- Company preparation (M14, R23). Never edit after commit.
-- Where a question you added came from, and when that was true: shown with it as "Verified by you (source, date)".
-- Generated predictions have neither and are always labelled "Generated prediction, not verified".
ALTER TABLE questions ADD COLUMN source_note TEXT;
ALTER TABLE questions ADD COLUMN source_date TEXT;
CREATE INDEX ix_questions_company ON questions(company) WHERE company IS NOT NULL;
