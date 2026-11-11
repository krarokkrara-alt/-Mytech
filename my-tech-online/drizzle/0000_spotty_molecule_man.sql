CREATE TABLE `accounting_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`body` text NOT NULL,
	`by_user` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_editors` (
	`email` text PRIMARY KEY NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`json` text NOT NULL
);
