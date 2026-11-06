CREATE TABLE IF NOT EXISTS focus_history_groups (
    group_key TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    kind TEXT NOT NULL CHECK(kind IN ('pomodoro','free')),
    task_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'open' CHECK(outcome IN ('open','completed','interrupted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_history_open ON focus_history_groups(kind,task_id) WHERE outcome='open';
CREATE INDEX IF NOT EXISTS idx_focus_history_task ON focus_history_groups(kind,task_id,started_at);
CREATE TABLE IF NOT EXISTS focus_history_spans (
    id INTEGER PRIMARY KEY,
    group_key TEXT NOT NULL REFERENCES focus_history_groups(group_key) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    cycle INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    phase_finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_focus_history_spans ON focus_history_spans(group_key,id);

CREATE TRIGGER IF NOT EXISTS focus_history_pomodoro_insert AFTER INSERT ON tool_pomodoro_runs
WHEN NEW.status='running' AND NEW.phase_started_at IS NOT NULL BEGIN
    INSERT INTO focus_history_groups(kind,task_id,started_at)
        SELECT 'pomodoro',NEW.id,NEW.phase_started_at WHERE NOT EXISTS (SELECT group_key FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open');
    INSERT INTO focus_history_spans(group_key,phase,cycle,rounds,started_at)
        SELECT group_key,NEW.phase,NEW.cycle_index,NEW.long_break_every,NEW.phase_started_at
        FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open';
END;

CREATE TRIGGER IF NOT EXISTS focus_history_pomodoro_resume AFTER UPDATE OF status ON tool_pomodoro_runs
WHEN NEW.status='running' AND NEW.phase_started_at IS NOT NULL AND OLD.status<>'running' BEGIN
    INSERT INTO focus_history_groups(kind,task_id,started_at)
        SELECT 'pomodoro',NEW.id,NEW.phase_started_at WHERE NOT EXISTS (SELECT group_key FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open');
    INSERT INTO focus_history_spans(group_key,phase,cycle,rounds,started_at)
        SELECT group_key,NEW.phase,NEW.cycle_index,NEW.long_break_every,NEW.phase_started_at
        FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open';
END;

CREATE TRIGGER IF NOT EXISTS focus_history_pomodoro_transition AFTER UPDATE OF status,phase ON tool_pomodoro_runs
WHEN NEW.status<>OLD.status OR NEW.phase<>OLD.phase BEGIN
    UPDATE focus_history_spans SET ended_at=MAX(started_at, MIN(NEW.updated_at, OLD.phase_started_at + COALESCE(OLD.phase_remaining_ms, CASE OLD.phase WHEN 'focus' THEN OLD.focus_ms WHEN 'short_break' THEN OLD.short_break_ms ELSE OLD.long_break_ms END)))
        WHERE OLD.status='running' AND ended_at IS NULL AND group_key IN (SELECT group_key FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open');
    UPDATE focus_history_spans SET phase_finished_at=CASE WHEN OLD.status='running' THEN ended_at ELSE MAX(ended_at,NEW.updated_at) END
        WHERE (OLD.phase<>NEW.phase OR NEW.status IN ('idle','completed')) AND phase=OLD.phase
          AND id=(SELECT MAX(id) FROM focus_history_spans WHERE group_key IN (SELECT group_key FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open'));
    UPDATE focus_history_groups SET outcome=CASE NEW.status WHEN 'completed' THEN 'completed' ELSE 'interrupted' END
        WHERE kind='pomodoro' AND task_id=NEW.id AND outcome='open' AND NEW.status IN ('idle','completed');
END;

CREATE TRIGGER IF NOT EXISTS focus_history_free_insert AFTER INSERT ON tool_free_focus
WHEN NEW.status='running' AND NEW.started_at IS NOT NULL BEGIN
    INSERT INTO focus_history_groups(kind,task_id,started_at)
        SELECT 'free',NEW.id,NEW.started_at WHERE NOT EXISTS (SELECT group_key FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id AND outcome='open');
    INSERT INTO focus_history_spans(group_key,phase,cycle,rounds,started_at)
        SELECT group_key,NEW.phase,1,1,NEW.started_at
        FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id AND outcome='open';
END;

CREATE TRIGGER IF NOT EXISTS focus_history_free_resume AFTER UPDATE OF status ON tool_free_focus
WHEN NEW.status='running' AND NEW.started_at IS NOT NULL AND OLD.status<>'running' BEGIN
    INSERT INTO focus_history_groups(kind,task_id,started_at)
        SELECT 'free',NEW.id,NEW.started_at WHERE NOT EXISTS (SELECT group_key FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id AND outcome='open');
    INSERT INTO focus_history_spans(group_key,phase,cycle,rounds,started_at)
        SELECT group_key,NEW.phase,1,1,NEW.started_at
        FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id AND outcome='open';
END;

CREATE TRIGGER IF NOT EXISTS focus_history_free_transition AFTER UPDATE OF status,phase ON tool_free_focus
WHEN NEW.status<>OLD.status OR NEW.phase<>OLD.phase BEGIN
    UPDATE focus_history_spans SET ended_at=MAX(started_at, CASE WHEN OLD.phase='break' THEN MIN(NEW.updated_at, OLD.started_at + OLD.rest_remaining_ms) ELSE NEW.updated_at END)
        WHERE OLD.status='running' AND ended_at IS NULL AND group_key IN (SELECT group_key FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id AND outcome='open');
    UPDATE focus_history_spans SET phase_finished_at=CASE WHEN OLD.status='running' THEN ended_at ELSE MAX(ended_at,NEW.updated_at) END
        WHERE (OLD.phase<>NEW.phase OR NEW.status IN ('idle','completed')) AND phase=OLD.phase
          AND id=(SELECT MAX(id) FROM focus_history_spans WHERE group_key IN (SELECT group_key FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id AND outcome='open'));
    UPDATE focus_history_groups SET outcome=CASE NEW.status WHEN 'completed' THEN 'completed' ELSE 'interrupted' END
        WHERE kind='free' AND task_id=NEW.id AND outcome='open' AND NEW.status IN ('idle','completed');
END;

CREATE TRIGGER IF NOT EXISTS focus_history_pomodoro_delete AFTER UPDATE OF deleted_at ON tool_pomodoro_tasks
WHEN NEW.deleted_at IS NOT NULL BEGIN
    DELETE FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.run_id;
END;
CREATE TRIGGER IF NOT EXISTS focus_history_pomodoro_tombstone AFTER INSERT ON tool_pomodoro_tasks
WHEN NEW.deleted_at IS NOT NULL BEGIN
    DELETE FROM focus_history_groups WHERE kind='pomodoro' AND task_id=NEW.run_id;
END;
CREATE TRIGGER IF NOT EXISTS focus_history_free_delete AFTER UPDATE OF deleted_at ON tool_free_focus
WHEN NEW.deleted_at IS NOT NULL BEGIN
    DELETE FROM focus_history_groups WHERE kind='free' AND task_id=NEW.id;
END;
