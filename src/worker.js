// Worker entry point. Static files in public/ are served by the assets binding;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
import { handleContact } from './contact.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/contact') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handleContact(request, env);
    }
    if (pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
