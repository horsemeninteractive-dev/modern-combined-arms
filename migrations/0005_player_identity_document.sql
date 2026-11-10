-- MCA accounts — Phase 4A: one atomic player-identity document.
--
-- Designs, the active design and equipped cosmetics used to be written as two
-- independent statements guarded only after the design rows had been replaced.
-- Two devices could both pass the revision check, and the slower writer could
-- delete designs the other had just saved.
--
-- The whole document now lives in one column on the row that already owns the
-- revision. One conditional UPDATE/INSERT persists everything or nothing, so
-- designs, active selection and cosmetics can never disagree. The original
-- `player_flags` table stays as a legacy read source for rows written before
-- this migration; it is no longer written.

ALTER TABLE player_presentation ADD COLUMN document TEXT;
