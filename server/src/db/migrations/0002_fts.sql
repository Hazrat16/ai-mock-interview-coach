-- Full-text search over what was asked and what you answered (History, R12). Never edit after commit.
-- One row per answer: the question as asked (after any rewording) and the transcript. Porter stemming, so
-- "index" also finds "indexes" and "indexing".

CREATE VIRTUAL TABLE answers_fts USING fts5(
  answer_id UNINDEXED,
  question_text,
  transcript,
  tokenize = 'porter unicode61'
);

-- Kept in sync by triggers, so every way of writing data (the app, restore, tests) is covered.
CREATE TRIGGER answers_fts_insert AFTER INSERT ON answers BEGIN
  INSERT INTO answers_fts (answer_id, question_text, transcript)
  SELECT new.id, t.question_text, new.transcript FROM turns t WHERE t.id = new.turn_id;
END;

CREATE TRIGGER answers_fts_update AFTER UPDATE OF transcript ON answers BEGIN
  UPDATE answers_fts SET transcript = new.transcript WHERE answer_id = new.id;
END;

-- Also fires for answers removed with their session (ON DELETE CASCADE).
CREATE TRIGGER answers_fts_delete AFTER DELETE ON answers BEGIN
  DELETE FROM answers_fts WHERE answer_id = old.id;
END;

CREATE TRIGGER answers_fts_question AFTER UPDATE OF question_text ON turns BEGIN
  UPDATE answers_fts SET question_text = new.question_text
  WHERE answer_id = (SELECT id FROM answers WHERE turn_id = new.id);
END;

INSERT INTO answers_fts (answer_id, question_text, transcript)
SELECT a.id, t.question_text, a.transcript FROM answers a JOIN turns t ON t.id = a.turn_id;
