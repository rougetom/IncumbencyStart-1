# Incumbency.AI — landing page

Astro landing page where Parliamentary staffers activate their Incumbency.AI account (and claim a free anti-theft laptop bag). Each submission is sent, signed, from the site's server to the Incumbency.AI CRM's lead webhook, where it becomes a staff member on the chosen MP's office.

- **MP list** — the "MP's office" picker is a searchable combobox populated from the CRM's public principals endpoint, proxied server-side through `src/pages/api/principals.ts` so the browser never calls the CRM directly.
- **Lead form** — posts to `src/pages/api/claim.ts`, which validates, drops bot submissions via a honeypot, then sends a **signed** `POST` to the CRM lead webhook (`{CRM_BASE_URL}/api/webhooks/leads`). The CRM creates the person, sets their role from the job title, and (because consent is given by submitting) adds them to Mailchimp. Marketing used to go through Resend/Mailchimp from this site; the CRM now owns all of that.
- **Attribution** — the landing URL's UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`) are copied into hidden form fields and sent with **every** sign-up as `last_touch`, even when the visitor declines cookies (nothing is stored on their device). With cookie consent, the first landing is also remembered in `localStorage` and sent as `first_touch`, along with the referrer and ad click ids (`gclid`, `fbclid`, `li_fat_id`). The CRM passes the contact's first-touch UTMs on to Mailchimp.
- **X pixel** — base pixel `riwug`, loaded with GA once cookies are accepted; every successful sign-up from a visitor who accepted cookies fires the X event `tw-riwug-rix6n` (`X_SIGNUP_EVENT_ID` in `src/lib/site.ts`).
- **LinkedIn Insight Tag** — loaded with GA once cookies are accepted; every successful sign-up from a visitor who accepted cookies fires LinkedIn conversion `30640108` (`LINKEDIN_CONVERSION_ID` in `src/lib/site.ts`).
- **Google Analytics** — each successful submission is recorded server-side as a `generate_lead` event (no personal data), so it counts even when a visitor declines cookies. Optional, via `GA_API_SECRET`.
- **Vercel Web Analytics** — enabled through the `@astrojs/vercel` adapter.
- **Style guide** — design tokens and components at `/styleguide` (noindex).

Fonts are self-hosted from `public/fonts/`: Sora (titles), IBM Plex Sans (body) and IBM Plex Mono (buttons, labels, data), all under the SIL Open Font License.

## Getting started

```sh
npm install
cp .env.example .env
npm run dev
```

Fill in `.env` with your own keys (see below), then open http://localhost:4321.

## Environment variables

| Variable | Where | Description |
| --- | --- | --- |
| `CRM_BASE_URL` | Server | CRM base URL, e.g. `https://crm.incumbency.ai`. |
| `LEADS_WEBHOOK_SECRET` | **Server only** | HMAC-SHA256 signing key, the same value as the CRM's `LEADS_WEBHOOK_SECRET`. Never expose it to the browser or commit it — anyone holding it can create people in the CRM. |
| `GA_API_SECRET` | Server | Google Analytics Measurement Protocol secret (**Admin → Data streams → your web stream → Measurement Protocol API secrets**). Optional: without it no conversion is recorded. |

These are read on each request, not frozen in at build time. Vercel only applies changes to new deployments, so redeploy once after adding or changing them. Logs are prefixed `[claim]` / `[principals]` and never contain names, emails or phone numbers.

### How a submission is signed

The claim route serialises the JSON body once and sends that exact string with two headers:

- `X-Timestamp: <unix seconds>`
- `X-Signature: sha256=<hex HMAC-SHA256 of "{timestamp}.{body}", keyed with LEADS_WEBHOOK_SECRET>`

Transient failures (429, 5xx, network) are retried up to three times with the **same** body and `event_id` and a fresh timestamp + signature. Any 2xx means the CRM has the lead. See the CRM's own `docs/lead-form-api.md` for the full contract.

## Project structure

```
src/
  components/
    ui/                    # design-system components (Button, Field, Combobox, Card…)
    landing/               # page sections (ClaimHero, ClaimForm, AboutSection, SiteFooter…)
  layouts/
    Layout.astro
  lib/
    leads.ts               # shared field list, validation, name/phone helpers, consent + job titles
    crm.ts                 # server-only: fetch MP list, send signed lead to the CRM
    server-env.ts          # per-request env access
    analytics-server.ts    # GA4 Measurement Protocol conversion
    site.ts                # public site constants
  pages/
    index.astro            # the landing page
    styleguide.astro       # design tokens & component reference
    api/
      principals.ts        # server-side proxy for the CRM MP list
      claim.ts             # validate + signed POST to the CRM lead webhook
  styles/
    global.css             # fonts, tokens, base styles
public/
  fonts/                   # WOFF2 fonts + OFL licences
  images/                  # hero + background imagery
```

## Job titles

The CRM sets each new person's role by matching `job_title` to its role names, **exactly and case-sensitively**. The option list lives in one constant, `JOB_TITLES` in `src/lib/leads.ts`. If an admin renames or adds a role in the CRM, update that list to match — there's no public endpoint for roles. "Other" sends free text and the CRM leaves the role "Unassigned" for someone to sort out.

## Deploying to Vercel

This project uses the [`@astrojs/vercel`](https://docs.astro.build/en/guides/integrations-guide/vercel/) adapter with `output: 'server'`, so it deploys as-is to Vercel with serverless functions for the API routes.

1. Push this repo to GitHub and import it into [Vercel](https://vercel.com/new).
2. Add the environment variables above in the Vercel project settings (Production, Preview, and Development as needed). Keep `LEADS_WEBHOOK_SECRET` out of any `PUBLIC_` variable.
3. Deploy. Web Analytics is enabled automatically via the adapter's `webAnalytics` option.

> **Preview/staging origins:** the browser never calls the CRM directly (the MP list is proxied server-side), so CORS doesn't need changing for preview deploys. If you ever switch to a direct browser fetch, add the origin under the CRM's Settings › Integrations › Lead webhook.

## Commands

| Command | Action |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local dev server at `localhost:4321` |
| `npm run build` | Build the production site to `./dist/` |
| `npm run preview` | Preview the build locally |
