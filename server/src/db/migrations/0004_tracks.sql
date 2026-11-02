-- Technical interview focus (backend, frontend, devops, data). Never edit after commit.
-- A question can belong to several tracks; an empty list means it is only asked without a focus.
-- Seed questions already in the bank get their tracks from seedQuestions on the next start.
ALTER TABLE questions ADD COLUMN tracks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tracks_json));
