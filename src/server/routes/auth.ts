import { Hono } from 'hono';
import type { Env } from '../types';
import { clearSessionCookie, getSession } from '../auth';
import { findUserByEmail } from '../db/user';

// Session endpoints shared by the SPA. Sign-in itself is handled by the
// Cloudflare OAuth routes under /api/auth/cf/* (see routes/cf-oauth.ts).
const auth = new Hono<{ Bindings: Env }>();

auth.get('/me', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ authenticated: false }, 401);
  const user = await findUserByEmail(c.env.DB, session.email);
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, user });
});

auth.post('/logout', (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

export default auth;
