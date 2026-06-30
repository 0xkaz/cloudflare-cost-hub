import type { D1Database } from '@cloudflare/workers-types';
import type { Workspace } from '../../shared/types';

export async function createDefaultWorkspace(
  db: D1Database,
  userId: string,
  name: string
): Promise<Workspace> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, userId, now)
    .run();
  await db
    .prepare(
      'INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    )
    .bind(id, userId, 'owner', now)
    .run();
  return { id, name, ownerId: userId, createdAt: now };
}

export async function findWorkspacesByUserId(db: D1Database, userId: string): Promise<Workspace[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, w.owner_id, w.created_at
       FROM workspaces w
       JOIN workspace_members m ON w.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY w.created_at DESC`
    )
    .bind(userId)
    .all();
  return (results || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    ownerId: String(row.owner_id),
    createdAt: String(row.created_at),
  }));
}
