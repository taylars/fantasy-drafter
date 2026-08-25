-- `support` was two questions wearing one coat, and it double-counted.
--
-- It was defined as "the teammates his production depends on", which for a
-- running back meant run blocking *and* whether he shares the backfield. Run
-- blocking is offense quality, which `offense` already grades — so a back on a
-- good line collected the same fact twice, and a back in a committee was
-- charged for something his projection had already priced.
--
-- It also graded inconsistently in practice, because two questions in one
-- number can be answered in two directions. J.K. Dobbins and RJ Harvey — the
-- same Denver backfield, the same line, both notes describing the same
-- committee — came out at -1 and +1.
--
-- So the column becomes the half that `offense` does not already cover: how
-- secure his role is, and nothing about how good the situation around it is.
ALTER TABLE player_grades RENAME COLUMN support TO position_security;

-- The old values answered a different question, so they are not a starting
-- point for the new one — a +1 for "good line, but a committee" says nothing
-- about role security on its own. Cleared rather than carried, so the board
-- runs on an honest 0 until the regrade lands. The old numbers survive in
-- data/grades/graded-*.json if they are ever wanted back.
UPDATE player_grades SET position_security = NULL;
