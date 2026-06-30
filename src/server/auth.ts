import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
import type { Env, Session } from './types';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function createSessionToken(session: Session, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  return new SignJWT({ userId: session.userId, email: session.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE)
    .sign(encoder.encode(secret));
}

export async function verifySessionToken(token: string, secret: string): Promise<Session | null> {
  try {
    const encoder = new TextEncoder();
    const { payload } = await jwtVerify(token, encoder.encode(secret));
    if (!payload.userId || !payload.email) return null;
    return {
      userId: String(payload.userId),
      email: String(payload.email),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(c: Context, token: string): void {
  const isSecure = c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https');
  c.header(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${
      isSecure ? '; Secure' : ''
    }`
  );
}

export function clearSessionCookie(c: Context): void {
  const isSecure = c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https');
  c.header(
    'set-cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`
  );
}

export async function getSession(c: Context<{ Bindings: Env }>): Promise<Session | null> {
  const cookie = c.req.header('cookie') || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  return verifySessionToken(match[1], c.env.SESSION_SECRET);
}
