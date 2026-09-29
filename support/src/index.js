// chat.reembir.com — customer-support chat.
// Static files (widget.js, the admin dashboard) come from ./public;
// every /api and /ws request goes to the single ChatHub Durable Object.

export { ChatHub } from './hub.js';

const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

function withCors(response, origin) {
  if (!origin || response.status === 101) return response;
  const r = new Response(response.body, response);
  r.headers.set('access-control-allow-origin', origin);
  r.headers.append('vary', 'Origin');
  for (const [k, v] of Object.entries(CORS_HEADERS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isVisitorApi = url.pathname.startsWith('/api/v/');
    const origin = request.headers.get('origin');

    if (request.method === 'OPTIONS' && isVisitorApi) {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin || '*', vary: 'Origin', ...CORS_HEADERS } });
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      // Durable Objects don't receive request.cf, so pass the visitor's location along as headers.
      const headers = new Headers(request.headers);
      headers.set('x-geo-country', request.cf?.country || '');
      headers.set('x-geo-city', request.cf?.city ? encodeURIComponent(request.cf.city) : '');
      const forwarded = new Request(request, { headers });
      const hub = env.HUB.get(env.HUB.idFromName('main'));
      const response = await hub.fetch(forwarded);
      return isVisitorApi ? withCors(response, origin) : response;
    }

    if (url.pathname === '/') return Response.redirect(`${url.origin}/admin/`, 302);
    return env.ASSETS.fetch(request);
  },
};
