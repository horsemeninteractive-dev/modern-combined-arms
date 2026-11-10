-- MCA accounts — Phase 4E: equipped unit camo on the identity document.
--
-- Camos are earned cosmetics like frames and backgrounds: ownership is derived
-- from career progress the account service already owns, and only the equipped
-- reference is stored. The column sits on `player_presentation` beside the frame
-- and background so one revision-guarded write still persists the whole
-- presentation, and an older row simply has no camo equipped.

ALTER TABLE player_presentation ADD COLUMN camo TEXT;
