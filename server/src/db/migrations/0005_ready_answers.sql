-- Interview-ready answers written in advance for bank questions, so the report needs no model for them.
-- Never edit after commit. Null: the answer is written by the model from what the candidate said.
-- Filled from the seed files by seedQuestions on every start.
ALTER TABLE questions ADD COLUMN ready_answer TEXT;
