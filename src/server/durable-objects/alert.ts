import type { DurableObjectState } from '@cloudflare/workers-types';

export class AlertDurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/dedup') {
      const { alertKey } = (await request.json()) as { alertKey: string };
      const existing = await this.state.storage.get<string>(alertKey);
      if (existing) {
        return new Response(JSON.stringify({ sent: false }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const now = new Date().toISOString();
      await this.state.storage.put(alertKey, now);
      return new Response(JSON.stringify({ sent: true, at: now }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }
}
