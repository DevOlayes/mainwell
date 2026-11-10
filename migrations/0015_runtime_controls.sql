-- Persistent administrator-controlled runtime switches and per-network fee ceilings.
CREATE TABLE IF NOT EXISTS mainwell_runtime_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO mainwell_runtime_settings(setting_key,setting_value,updated_by,updated_at)
VALUES
 ('automation_enabled','false','system-default',datetime('now')),
 ('execution_enabled','false','system-default',datetime('now'));
