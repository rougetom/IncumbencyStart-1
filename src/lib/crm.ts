// Server-only CRM access: load the public MP list, and send signed leads to the
// lead webhook. LEADS_WEBHOOK_SECRET is read here and must never reach the
// browser. Import this only from API routes / server code.
import { createHmac, randomUUID } from 'node:crypto';
import { env } from './server-env';
import { SEGMENT, type Principal, type Touch } from './leads';

const PRINCIPAL_KEYS = ['id', 'name', 'party', 'constituency', 'region'] as const;

/** Production CRM, used when CRM_BASE_URL isn't set (e.g. staging overrides it). */
const DEFAULT_CRM_BASE_URL = 'https://crm.incumbency.ai';

function base(): string {
  return (env('CRM_BASE_URL') ?? DEFAULT_CRM_BASE_URL).replace(/\/+$/, '');
}

/** Keep only the known string fields from an untrusted principal record. */
function cleanPrincipal(raw: unknown): Principal | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : typeof record.id === 'number' ? String(record.id) : '';
  const name = typeof record.name === 'string' ? record.name : '';
  if (!id || !name) return null;
  const out: Principal = { id, name };
  for (const key of PRINCIPAL_KEYS) {
    if (key === 'id' || key === 'name') continue;
    const value = record[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/** The current MPs for this segment, fetched server-side from the CRM. */
export async function fetchPrincipals(): Promise<Principal[]> {
  const response = await fetch(`${base()}/api/public/principals?segment=${SEGMENT}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`CRM principals responded with HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('CRM principals response was not an array');
  return data.map(cleanPrincipal).filter((p): p is Principal => p !== null);
}

/** Fields the route assembles; event_id and captured_at are added here. */
export type LeadPayload = {
  segment: string;
  principal_id: string;
  full_name: string;
  first_name: string;
  last_name?: string;
  phone: string;
  email: string;
  job_title: string;
  form_id: string;
  consent_marketing: true;
  consent_text: string;
  first_touch?: Touch;
  last_touch?: Touch;
};

export type LeadResult = { ok: true; status: number; data: unknown };

const RETRYABLE = (status: number) => status === 429 || status >= 500;

/**
 * Send a lead to the CRM webhook, signed with HMAC-SHA256 over
 * "{timestamp}.{body}". The body is serialised once and that exact string is
 * both signed and sent. Retries transient failures (429 / 5xx / network) with
 * the same body and event_id and a fresh timestamp + signature.
 *
 * Any 2xx means the CRM has the lead (including 200 duplicate and 202 failed,
 * which is stored for an admin to replay — not something to resend). Throws on
 * non-retryable rejections (e.g. 401 bad secret/clock, 413 too large, 503 no
 * secret) and after exhausting retries.
 */
export async function sendLeadToCrm(payload: LeadPayload, eventId: string = randomUUID()): Promise<LeadResult> {
  const secret = env('LEADS_WEBHOOK_SECRET');
  if (!secret) throw new Error('LEADS_WEBHOOK_SECRET is not set');

  const body = JSON.stringify({ event_id: eventId, captured_at: new Date().toISOString(), ...payload });
  const url = `${base()}/api/webhooks/leads`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ts = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': String(ts),
          'X-Signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return { ok: true, status: response.status, data };
      }
      if (!RETRYABLE(response.status)) {
        throw new Error(`CRM rejected lead: HTTP ${response.status}`);
      }
      lastError = new Error(`CRM lead webhook responded with HTTP ${response.status}`);
    } catch (error) {
      // A thrown "CRM rejected lead" is non-retryable: surface it immediately.
      if (error instanceof Error && error.message.startsWith('CRM rejected lead')) throw error;
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }

  throw lastError instanceof Error ? lastError : new Error('CRM unavailable');
}
