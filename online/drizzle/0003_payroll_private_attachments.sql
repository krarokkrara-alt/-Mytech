CREATE TABLE payroll_private_attachments (attachment_id TEXT PRIMARY KEY);
--> statement-breakpoint
UPDATE trello_jobs SET status='cancelled',phase=NULL,last_error='ข้อมูลเงินเดือนและหลักฐานเก็บเฉพาะในโปรแกรม' WHERE kind IN ('payroll','employee') AND status NOT IN ('done','cancelled');
