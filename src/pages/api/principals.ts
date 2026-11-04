import type { APIRoute } from 'astro';
import { fetchPrincipals } from '../../lib/crm';

export const prerender = false;

// Server-side proxy for the CRM's public MP list, so the browser never calls
// the CRM directly (no CORS to manage) and the list can be cached at the edge.
// The CRM already caches for an hour; we mirror that with s-maxage.
export const GET: APIRoute = async () => {
  try {
    const principals = await fetchPrincipals();
    return new Response(JSON.stringify(principals), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // The MP list barely changes, so cache it hard. The Vercel edge serves
        // the cached copy for a day (s-maxage) and keeps serving the old one for
        // up to a week while it revalidates in the background, so the CRM is
        // hit ~once a day per region, never on an ordinary visit.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
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
