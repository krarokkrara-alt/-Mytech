CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE members (email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('staff')), name TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE attachments (id TEXT PRIMARY KEY, record_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, base64 TEXT NOT NULL, by_user TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE secrets (id TEXT PRIMARY KEY, value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE recovery_backups (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
