CREATE TABLE trello_routes (record_key TEXT PRIMARY KEY, kind TEXT NOT NULL, record_id TEXT NOT NULL, scope TEXT NOT NULL, target TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE trello_jobs (id TEXT PRIMARY KEY, record_key TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, scope TEXT NOT NULL, target TEXT NOT NULL, snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, phase TEXT, progress TEXT NOT NULL DEFAULT '{}', last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX trello_jobs_pending ON trello_jobs(status,next_at,created_at);
--> statement-breakpoint
CREATE TABLE trello_sync_lock (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE attachment_requests (request_id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE action_results (request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, response TEXT NOT NULL);
