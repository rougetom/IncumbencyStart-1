import type { APIRoute } from 'astro';
import { fetchPrincipals } from '../../lib/crm';
import { env } from '../../lib/server-env';

export const prerender = false;

// Server-side proxy for the CRM's public MP list, so the browser never calls
// the CRM directly (no CORS to manage) and the list can be cached at the edge.
// The CRM already caches for an hour; we mirror that with s-maxage.
export const GET: APIRoute = async () => {
  if (!env('CRM_BASE_URL')) {
    console.error('[principals] CRM_BASE_URL is not set');
    return new Response(JSON.stringify({ error: 'The MP list is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const principals = await fetchPrincipals();
    return new Response(JSON.stringify(principals), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error(`[principals] Could not load MP list: ${error instanceof Error ? error.message : String(error)}`);
    return new Response(JSON.stringify({ error: 'Could not load the MP list.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
