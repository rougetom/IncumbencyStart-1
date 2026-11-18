import { defineMiddleware } from 'astro:middleware';

// Sign-ups have moved to the main site. Every page on this site now sends the
// visitor there, keeping the query string so ad UTMs survive the hop.
// 302 (temporary) so browsers don't cache it: delete this file to bring the
// landing page back. /api/* is left working for anything still calling it.
const DESTINATION = 'https://www.incumbency.ai/activate';

export const onRequest = defineMiddleware(({ url }, next) => {
  if (url.pathname.startsWith('/api/')) return next();
  return new Response(null, {
    status: 302,
    headers: { Location: `${DESTINATION}${url.search}`, 'Cache-Control': 'no-store' },
  });
});
