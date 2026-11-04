/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** CRM base URL, e.g. https://crm.incumbency.ai */
  readonly CRM_BASE_URL: string;
  /** HMAC secret shared with the CRM lead webhook. Server only. */
  readonly LEADS_WEBHOOK_SECRET: string;
  /** GA4 Measurement Protocol secret. Optional: records successful submissions. */
  readonly GA_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
