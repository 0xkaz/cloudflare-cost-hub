import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '../../shared/types';

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db
    .prepare('SELECT id, email, name, picture, created_at FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name ? String(row.name) : null,
    picture: row.picture ? String(row.picture) : null,
    createdAt: String(row.created_at),
  };
}

export async function findUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db
    .prepare('SELECT id, email, name, picture, created_at FROM users WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name ? String(row.name) : null,
    picture: row.picture ? String(row.picture) : null,
    createdAt: String(row.created_at),
  };
}

export async function createUser(
  db: D1Database,
  user: Omit<User, 'createdAt'>
): Promise<User> {
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.email, user.name, user.picture, now)
    .run();
  return { ...user, createdAt: now };
}
