// Shared lead-form logic used by both the browser (client validation) and the
// server (/api/claim). No secrets and no server-only APIs live here, so it is
// safe to import from client scripts.

/** CRM segment this form captures into. */
export const SEGMENT = 'uk-commons';

/** Stable identifier for this form, stored on each lead in the CRM. */
export const FORM_ID = 'landing-page';

/**
 * The marketing-consent wording shown directly under the submit button.
 * Consent is given by submitting the form, so this exact string is sent to the
 * CRM as `consent_text` — the record of what the visitor agreed to. The page
 * and the server both read it here so they can never drift apart. If it
 * changes, new submissions carry the new text.
 */
export const CONSENT_TEXT =
  'By submitting this form you agree to receive emails about Incumbency.ai. You can unsubscribe at any time.';

/**
 * Job titles the CRM maps to its role names. The match is exact and
 * case-sensitive, so these strings must match the CRM's roles character for
 * character. There is no public endpoint for roles: if an admin renames or
 * adds a role in the CRM, update this list to match.
 */
export const JOB_TITLES = [
  'Chief of Staff',
  'Office Manager',
  'Parliamentary Assistant',
  'Senior Caseworker',
  'Caseworker',
  'Researcher',
  'Communications Officer',
  'Diary Manager',
] as const;

/** The "pick something else" option that reveals a free-text input. */
export const OTHER_JOB_TITLE = 'Other';

/** An MP as returned by the CRM's public principals endpoint. */
export type Principal = {
  id: string;
  name: string;
  party?: string;
  constituency?: string;
  region?: string;
};

/** One attribution touch (first landing or the submitting visit). */
export type Touch = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  li_fat_id?: string;
  landing_url?: string;
  referrer?: string;
  occurred_at?: string;
};

/** The keys allowed on a touch, each a short string. */
export const TOUCH_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'li_fat_id',
  'landing_url',
  'referrer',
  'occurred_at',
] as const;

/**
 * Keep only known touch keys with non-empty string values, each capped in
 * length. Returns undefined when nothing usable remains, so empty touches are
 * omitted rather than sent. Attribution never blocks a lead.
 */
export function sanitiseTouch(value: unknown): Touch | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const out: Touch = {};
  let has = false;
  for (const key of TOUCH_KEYS) {
    const v = record[key];
    if (typeof v === 'string' && v.trim()) {
      out[key] = v.trim().slice(0, 500);
      has = true;
    }
  }
  return has ? out : undefined;
}

export const LEAD_FIELDS = ['full_name', 'mobile', 'email', 'job_title', 'job_title_other', 'principal_id'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export type LeadInput = Record<LeadField, string>;
export type LeadErrors = Partial<Record<LeadField, string>>;

const MIN = 2;
const MAX = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MESSAGES = {
  fullNameMissing: 'Please enter your full name.',
  fullNameLength: 'Please enter your full name (2–200 characters).',
  mobileMissing: 'Please enter your mobile number.',
  mobileInvalid: 'Please enter a UK mobile number starting 07 or +44.',
  emailMissing: 'Please enter your email address.',
  emailInvalid: 'Please enter a valid email address.',
  jobTitleMissing: 'Please choose your job title.',
  jobTitleInvalid: 'Please choose a job title from the list.',
  jobTitleOtherMissing: 'Please enter your job title.',
  jobTitleOtherLength: 'Please enter your job title (2–200 characters).',
  principalMissing: "Please choose your MP's office from the list.",
} as const;

/** Collapse runs of whitespace and trim the ends. */
export function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Accepts a UK mobile written nationally (`07…`, 11 digits) or internationally
 * (`+447…` / `00447…`), ignoring spaces, dashes and brackets, and returns it in
 * E.164 form (`+447700900123`). Returns null if it isn't a UK mobile.
 */
export function normaliseUkMobile(value: string): string | null {
  const compact = value.replace(/[\s().-]/g, '');
  const match = compact.match(/^(?:0|\+44|0044)(7\d{9})$/);
  return match ? `+44${match[1]}` : null;
}

/**
 * Split a display name into first/last for the CRM, keeping the original too.
 * The last word is the surname; everything before it is the first name. A
 * single word is sent as the first name with no surname (the CRM triages it).
 */
export function splitName(fullName: string): { first_name: string; last_name?: string } {
  const parts = collapse(fullName).split(' ');
  if (parts.length <= 1) return { first_name: parts[0] ?? '' };
  const last_name = parts.pop() as string;
  return { first_name: parts.join(' '), last_name };
}

/** Resolve the job title to send: a listed option as-is, or the free text for "Other". */
export function resolveJobTitle(jobTitle: string, other: string): string {
  return jobTitle === OTHER_JOB_TITLE ? collapse(other) : jobTitle;
}

/** The normalised lead, ready to send to the CRM (minus server-added fields). */
export type NormalisedLead = {
  full_name: string;
  first_name: string;
  last_name?: string;
  phone: string;
  email: string;
  job_title: string;
  principal_id: string;
};

/**
 * Validate the raw form fields. Returns one message per failing field and, when
 * everything passes, the normalised lead. Used verbatim on both sides so the
 * browser and the server always agree.
 */
export function validateLead(input: Partial<Record<LeadField, unknown>>): {
  lead: NormalisedLead | null;
  errors: LeadErrors;
} {
  const text = (key: LeadField) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  const fullName = collapse(text('full_name'));
  const email = text('email').trim().toLowerCase();
  const jobTitleRaw = text('job_title').trim();
  const jobTitleOther = collapse(text('job_title_other'));
  const principalId = text('principal_id').trim();
  const errors: LeadErrors = {};

  if (!fullName) errors.full_name = MESSAGES.fullNameMissing;
  else if (fullName.length < MIN || fullName.length > MAX) errors.full_name = MESSAGES.fullNameLength;

  let phone: string | null = null;
  if (!text('mobile').trim()) {
    errors.mobile = MESSAGES.mobileMissing;
  } else {
    phone = normaliseUkMobile(text('mobile'));
    if (!phone) errors.mobile = MESSAGES.mobileInvalid;
  }

  if (!email) errors.email = MESSAGES.emailMissing;
  else if (email.length > MAX || !EMAIL_PATTERN.test(email)) errors.email = MESSAGES.emailInvalid;

  if (!jobTitleRaw) {
    errors.job_title = MESSAGES.jobTitleMissing;
  } else if (jobTitleRaw !== OTHER_JOB_TITLE && !JOB_TITLES.includes(jobTitleRaw as (typeof JOB_TITLES)[number])) {
    errors.job_title = MESSAGES.jobTitleInvalid;
  } else if (jobTitleRaw === OTHER_JOB_TITLE) {
    if (!jobTitleOther) errors.job_title_other = MESSAGES.jobTitleOtherMissing;
    else if (jobTitleOther.length < MIN || jobTitleOther.length > MAX) errors.job_title_other = MESSAGES.jobTitleOtherLength;
  }

  if (!principalId) errors.principal_id = MESSAGES.principalMissing;

  if (Object.keys(errors).length > 0 || !phone) return { lead: null, errors };

  return {
    lead: {
      full_name: fullName,
      ...splitName(fullName),
      phone,
      email,
      job_title: resolveJobTitle(jobTitleRaw, jobTitleOther),
      principal_id: principalId,
    },
    errors,
  };
}
