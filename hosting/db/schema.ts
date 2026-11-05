import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const sudokuProgress = sqliteTable('sudoku_progress', {
  userId: text('user_id').primaryKey(),
  stateJson: text('state_json').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: text('updated_at').notNull(),
});
