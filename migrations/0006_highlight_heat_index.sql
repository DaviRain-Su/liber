-- Speeds up reader-side highlight heat aggregation by sentence.
CREATE INDEX IF NOT EXISTS idx_hl_book_sid ON highlights (book_id, sid);
