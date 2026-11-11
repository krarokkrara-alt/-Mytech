import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const state = sqliteTable('accounting_state',{id:integer('id').primaryKey(),revision:integer('revision').notNull(),json:text('json').notNull()});
export const editors = sqliteTable('accounting_editors',{email:text('email').primaryKey(),grantedBy:text('granted_by').notNull(),createdAt:text('created_at').notNull()});
export const attachments = sqliteTable('accounting_attachments',{id:text('id').primaryKey(),recordId:text('record_id').notNull(),name:text('name').notNull(),mime:text('mime').notNull(),body:text('body').notNull(),by:text('by_user').notNull()});
export const snapshots = sqliteTable('accounting_snapshots',{id:text('id').primaryKey(),json:text('json').notNull(),createdAt:text('created_at').notNull()});
