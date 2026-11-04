import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import {
  CONSENT_TEXT,
  FORM_ID,
  SEGMENT,
  LEAD_FIELDS,
  sanitiseTouch,
  validateLead,
  type LeadField,
} from '../../lib/leads';
import { sendLeadToCrm, type LeadPayload } from '../../lib/crm';
import { parseAnalyticsIds, recordClaimConversion } from '../../lib/analytics-server';
import { missing } from '../../lib/server-env';

export const prerender = false;

// CRM_BASE_URL has a production default, so only the signing secret is required.
const REQUIRED_VARS = ['LEADS_WEBHOOK_SECRET'] as const;

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Keeps emails out of logs while leaving them recognisable: j***@example.com
function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function describeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export const POST: APIRoute = async ({ request }) => {
  const absent = missing(REQUIRED_VARS);
  if (absent.length) {
    console.error(`[claim] Not configured — missing: ${absent.join(', ')}`);
    return json({ error: 'The form is not configured on the server.' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  // Honeypot: a filled "website" means a bot. Pretend success, send nothing.
  if (typeof body.website === 'string' && body.website.trim()) {
    console.log('[claim] result honeypot=tripped');
    return json({ success: true }, 200);
  }

  const raw = Object.fromEntries(LEAD_FIELDS.map((key) => [key, body[key]])) as Partial<Record<LeadField, unknown>>;
  const { lead, errors } = validateLead(raw);
  if (!lead) {
    const firstError = LEAD_FIELDS.map((key) => errors[key]).find(Boolean);
    return json({ error: firstError ?? 'Please check the form and try again.', fields: errors }, 400);
  }

  const payload: LeadPayload = {
    segment: SEGMENT,
    principal_id: lead.principal_id,
    full_name: lead.full_name,
    first_name: lead.first_name,
    ...(lead.last_name ? { last_name: lead.last_name } : {}),
    phone: lead.phone,
    email: lead.email,
    job_title: lead.job_title,
    form_id: FORM_ID,
    consent_marketing: true,
    consent_text: CONSENT_TEXT,
    ...(sanitiseTouch(body.first_touch) ? { first_touch: sanitiseTouch(body.first_touch) } : {}),
    ...(sanitiseTouch(body.last_touch) ? { last_touch: sanitiseTouch(body.last_touch) } : {}),
  };

  const who = `principal=${lead.principal_id} email=${maskEmail(lead.email)}`;

  try {
    const result = await sendLeadToCrm(payload, randomUUID());
    const outcome =
      result.status === 200 && (result.data as { duplicate?: boolean })?.duplicate
        ? 'duplicate'
        : (result.data as { status?: string })?.status ?? `http_${result.status}`;

    // Reporting the conversion to GA must never fail the lead itself.
    let analytics = 'failed';
    try {
      analytics = await recordClaimConversion(parseAnalyticsIds(body.analytics));
    } catch (error) {
      console.error(`[claim] Google Analytics conversion failed: ${describeError(error)}`);
    }

    console.log(`[claim] result crm=${outcome} ga=${analytics} ${who}`);
    return json({ success: true }, 200);
  } catch (error) {
    console.error(`[claim] CRM send failed: ${describeError(error)} ${who}`);
    return json({ error: 'Could not submit the form. Please try again later.' }, 502);
  }
};
