# Resend for calvin transactional email

## Question

How should calvin, a Node/TypeScript PoC, send its six transactional emails through Resend from Temporal activities that may be retried (at-least-once)? It needs no duplicate email per committer and plan (NFR008), SPF and DKIM on the sending domain (NFR009), and works at about 100 emails in total. The areas covered: idempotency, scheduled sending, domain authentication, quotas and rate limits, html/text bodies, tags and webhooks, API key scopes, and test addresses.

## Answer in one sentence

Call `resend.emails.send(payload, { idempotencyKey })` from the activity with a deterministic key such as `<email-type>/<plan-id>/<committer-id>` and a deterministic payload. Resend sends a given key only once for 24 hours, which covers Temporal activity retries. Use Temporal timers rather than `scheduledAt` for the reminders. Send from a verified subdomain, which has SPF (`send` MX + TXT) and DKIM (`resend._domainkey` TXT); DMARC is a TXT record you add yourself. Use a domain-restricted "Sending access" key in `RESEND_API_KEY`, and test against `delivered@resend.dev`. The free tier (100/day, 3,000/month, 10 req/s per team) is far above calvin's volume.

## Versions

- `resend` npm package **6.34.1** (`latest` dist-tag, published 2026-10-16T17:30:15Z). Checked 2026-10-27 against registry.npmjs.org (README plus the published tarball's `dist/index.d.mts` and `dist/index.mjs`).
- Resend REST API: not versioned. The docs say: "Currently, there's no versioning system in place." ([API Introduction](https://resend.com/docs/api-reference/introduction))
- Docs read 2026-10-27 at resend.com/docs (the `.md` page sources listed in https://resend.com/docs/llms.txt).

---

## Idempotency Keys

**What it is.** An optional request key. Resend uses it to process a send only once, even if the request arrives several times, and on a repeat it returns the original response.

**What it replaces.** A home-made "already sent?" table checked before every send, or the risk of duplicate emails when a Temporal activity retries after the HTTP call succeeded but before the activity completed.

**Limits and behaviour.**
- Transport: `Idempotency-Key` HTTP header. The Node SDK exposes it as the second argument: `resend.emails.send(payload, { idempotencyKey })`. `resend.batch.send` accepts it too. SMTP uses the `Resend-Idempotency-Key` header instead.
- Window: the key is remembered for 24 hours.
- Same key with the same payload: Resend returns the same response and does not send again.
- Same key with a different payload: `409 invalid_idempotent_request`. The body must match the original exactly.
- Same key while the first request is still in progress: `409 concurrent_idempotent_requests`, and the docs say to retry later.
- Length: 1 to 256 characters. Otherwise the API returns `400 invalid_idempotency_key`.
- Recommended format: `<event-type>/<entity-id>`.

**Sources.**
- [Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys): "Resend checks whether an email with the same idempotency key has already been sent in the last 24 hours."
- Same page: "you can make the same request and our API will give the same response, without actually sending the email again."
- Same page: "Idempotency keys can be up to 256 characters and must be unique per API request."
- Same page: "Send the key in the `Idempotency-Key` HTTP header in your API requests. Our SDKs also provide a convenient way to set this header. If you're using SMTP, you can set the `Resend-Idempotency-Key` email header instead."
- Same page: "format idempotency keys like `<event-type>/<entity-id>`, for example `welcome-user/123456789`."
- Same page (Node example): `await resend.emails.send({ ... }, { idempotencyKey: 'welcome-user/123456789' });`
- [Errors](https://resend.com/docs/api-reference/errors): `invalid_idempotent_request`, "Status: 409", "This idempotency key has been used with this HTTP method and endpoint within the last 24 hours, but the request body was modified and doesn't match the original request."
- Same page: `concurrent_idempotent_requests`, "Status: 409", "There is another request in progress with the same idempotency key." The suggested action is "Try the request again later."
- Same page: `invalid_idempotency_key`, "Status: 400", "Idempotency keys, if present, must have between 1 and 256 characters."
- SDK 6.34.1 `dist/index.d.mts`: `export interface CreateEmailRequestOptions extends PostOptions, IdempotentRequest {}` and `idempotencyKey?: string;` with the comment "If provided, will be sent as the `Idempotency-Key` header."

---

## Schedule Email (`scheduled_at` / `scheduledAt`) and Cancel Email

**What it is.** Resend holds the email and sends it at a later time. The time is given as ISO 8601 or natural language (for example "in 1 hour"). A scheduled email can be rescheduled with `emails.update({ id, scheduledAt })` and cancelled with `emails.cancel(id)`, or from the dashboard.

**What it replaces.** Your own scheduler, cron job, or delay queue for future sends.

**Limits.**
- An email can be scheduled at most 30 days in advance.
- Cancel and reschedule need the Resend email `id` returned by the original send, so you must store it.
- SMTP sends cannot be scheduled.
- A scheduled email fails if the API key that created it is deleted or suspended before send time, or if the account is under review.
- Node SDK uses camelCase: `scheduledAt`, not `scheduled_at`.

**Sources.**
- [Schedule Email](https://resend.com/docs/dashboard/emails/schedule-email): "Emails can be scheduled up to 30 days in advance."
- Same page: "The date can be defined using natural language, such as `\"in 1 hour\"`, `\"tomorrow at 9am\"`, or `\"Friday at 3pm ET\"`."
- Same page (Reschedule): `resend.emails.update({ id: '49a3...', scheduledAt: 'in 1 min' });`
- Same page: "**API key is no longer active** - The API key used to schedule the email has been deleted, expired, or suspended. The email cannot be sent."
- Same page, Limitations: "Emails sent via SMTP cannot be scheduled".
- [Cancel Email](https://resend.com/docs/api-reference/emails/cancel-email): "Cancel a scheduled email." Node: `await resend.emails.cancel('49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');`
- [Send with Node.js](https://resend.com/docs/send-with-nodejs): "the Node.js SDK uses camelCase (`replyTo`, `scheduledAt`)".

---

## Verified Domains (SPF, DKIM), Implementing DMARC, Custom Return Path

**What it is.** Before Resend sends from a domain, you add DNS records that it generates and it verifies them. They cover:
- SPF on the Return-Path subdomain (default `send`): an MX record pointing at `feedback-smtp.<region>.amazonses.com` and a TXT record `v=spf1 include:amazonses.com ~all`.
- DKIM: a TXT record at `resend._domainkey`.

Resend does not add DMARC. It is a separate `_dmarc` TXT record that you add yourself after verification. Resend recommends sending from a subdomain.

**What it replaces.** Running your own MTA and DKIM signing.

**Limits.**
- Records must match exactly what Resend generates.
- Verification often completes within 15 minutes but can take up to 72 hours.
- Do not proxy CNAMEs (for example Cloudflare's orange cloud).
- The custom Return-Path is fixed when the domain is created. The default is `send`, a custom one must be 63 characters or fewer, and changing it means deleting and re-adding the domain.
- The free plan allows up to 3 verified domains.

**Sources.**
- [Add and verify a domain](https://resend.com/docs/add-a-domain): "Provide the DKIM and SPF configurations (`TXT` and `MX` or `CNAME` records) to your DNS provider. These records must match exactly what Resend generated."
- Same page: "We strongly recommend sending emails from a subdomain (e.g., `notifications.example.com`) instead of your root domain".
- Same page: "your domain will often verify within 15 minutes of adding the DNS records. However, DNS changes can occasionally take up to 72 hours to propagate globally."
- Same page: "Return-Path defaults to `send.example.com`, although you can provide a custom path."
- [Cloudflare DNS guide](https://resend.com/docs/guides/dns/cloudflare) (record shapes): MX `send` → `feedback-smtp.us-east-1.amazonses.com` with priority `10`; TXT `send` → `"v=spf1 include:amazonses.com ~all"`; TXT name `resend._domainkey` for DKIM.
- [Implementing DMARC](https://resend.com/docs/dashboard/domains/dmarc): "If you have a verified domain with Resend, it means you are already passing SPF and DKIM."
- Same page: "DMARC is added to a domain through a TXT record added to the domain at `_dmarc`." The example is `v=DMARC1; p=none; rua=mailto:dmarcreports@example.com;`.
- Same page: "we suggest starting with a policy of `p=none;` before moving to a stricter policy."
- [Configure a custom Return Path](https://resend.com/docs/dashboard/domains/custom-return-path): "The Return-Path is set when the domain is created and cannot be changed afterwards".
- Same page: "Must be 63 characters or less."
- [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits): "Domains: up to 3 verified domains."

---

## Usage Limits (rate limits and email quotas) and Errors

**What it is.** Resend applies three kinds of limit:
- A per-team request rate limit.
- Daily and monthly email quotas. The daily quota applies on the free plan only.
- A contacts quota, which only matters for marketing and is not relevant to calvin.

**What it replaces.** Nothing. These are constraints calvin must handle.

**Limits.**
- Free plan: 100 emails/day (UTC calendar day, resets at midnight UTC) and 3,000/month. Each To/CC/BCC recipient counts separately. Test emails count too.
- Rate: 10 requests/second per team, shared across all keys, with no burst allowance.
- 429 error types: `rate_limit_exceeded`, `daily_quota_exceeded`, `monthly_quota_exceeded`.
- Response headers: `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after`, plus `x-resend-daily-quota` and `x-resend-monthly-quota`.
- How to retry: wait `retry-after` seconds for `rate_limit_exceeded`. Quota errors do not clear by retrying soon. The daily one clears at midnight UTC, and the monthly one needs a plan upgrade.
- 500 `application_error` and 503 `service_unavailable`: the docs say to "Try the request again later."
- No retry logic: the SDK 6.34.1 dist contains no retry or 429 handling, and it returns `{ data, error }` instead of throwing.

**Sources.**
- [Usage Limits](https://resend.com/docs/api-reference/rate-limit): "The default maximum rate limit is **10 requests per second per team**. This limit applies across all API keys associated with your team."
- Same page: "`retry-after` | How many seconds to wait before making a follow-up request."
- Same page: "The daily quota applies only to the Free plan. It is a UTC calendar day (00:00–24:00 UTC) and resets at midnight UTC".
- [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits): "daily email quota of 100 emails/day and 3,000 emails/month."
- Same page: "Multiple `To`, `CC`, or `BCC` recipients in sent emails count as separate emails towards this quota."
- Same page: "There is no separate burst allowance above the stated limit."
- [Send Test Emails](https://resend.com/docs/dashboard/emails/send-test-emails): "Test emails count against your account's sending quota."
- [Errors](https://resend.com/docs/api-reference/errors): `rate_limit_exceeded`, "Status: 429", "Too many requests. Please limit the number of requests per second."
- Same page: `daily_quota_exceeded`, "Status: 429", "...or wait for the quota to reset at midnight UTC."
- Same page: `monthly_quota_exceeded`, "Status: 429".
- Same page: `application_error`, "Status: 500", "Try the request again later."
- [Send with Node.js](https://resend.com/docs/send-with-nodejs): "the SDK returns `{ data, error }` instead of throwing. Only use `try/catch` if you need to handle network-level failures."
- [What is Resend Pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing): "Free | $0/mo | 3,000 | Not available" (no overage on the free plan).

---

## Send Email: `html` and `text` (React optional)

**What it is.** `emails.send` accepts `html`, `text` and `react`, and each is optional.
- If `text` is omitted, Resend generates it from the HTML. Passing an empty string opts out.
- A text-only send works, as in the README's first example: `text: 'it works!'`.
- `react` is available only in the Node SDK and is optional. calvin can ignore React Email.
- `template` cannot be combined with `html`, `text` or `react`.

**What it replaces.** A MIME builder or template engine for multipart emails.

**Limits.**
- `to`: at most 50 recipients.
- Attachments: up to 40MB per email.

**Sources.**
- [Send Email](https://resend.com/docs/api-reference/emails/send-email): "**text** `string` The plain text version of the message."
- Same page: "If not provided, the HTML will be used to generate a plain text version. You can opt out of this behavior by setting value to an empty string."
- Same page: "**react** `React.ReactNode` ... *Only available in the Node.js SDK.*"
- Same page: "Recipient email address. ... Max 50."
- npm README (resend 6.34.1): `await resend.emails.send({ from: 'you@example.com', to: 'user@gmail.com', replyTo: 'you@example.com', subject: 'hello world', text: 'it works!' });`

---

## Managing Tags, Custom Headers, Webhooks

**What it is.**
- `tags`: name/value pairs, up to 75 per email, echoed back in webhook events. Useful for `email_type=reminder_24h` or `plan_id=...`.
- `headers`: arbitrary custom headers. Examples: `X-Entity-Ref-ID` to stop Gmail threading, and `List-Unsubscribe`.
- Webhooks: signed HTTPS POSTs for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `email.opened`, `email.clicked`, and `email.scheduled`. Events can be replayed.

**What it replaces.** Your own send log and delivery-status polling.

**Limits.**
- Tag name and value: ASCII letters, digits, `_` and `-` only, up to 256 characters each.
- Email data is kept for 30 days.

**Sources.**
- [Managing Tags](https://resend.com/docs/dashboard/emails/tags): "After the email is sent, the tag is included in the webhook event. Tags can include ASCII letters, numbers, underscores, or dashes. You can add up to 75 tags per email."
- Same page: "Note the category of email sent, like \"welcome\" or \"password reset\"".
- [Send Email](https://resend.com/docs/api-reference/emails/send-email), tags: "It can only contain ASCII letters (a–z, A–Z), numbers (0–9), underscores (\_), or dashes (-). It can contain no more than 256 characters."
- [Custom Headers](https://resend.com/docs/dashboard/emails/custom-headers): "Prevent threading on Gmail with the **`X-Entity-Ref-ID`** header".
- [Webhooks](https://resend.com/docs/webhooks/introduction): "receive real-time and actionable updates on the delivery, open, bounce, and click events of your emails."
- [Event Types](https://resend.com/docs/webhooks/event-types): "`email.delivered` Occurs whenever Resend **successfully delivered the email** to the recipient's mail server."
- Same page: "`email.bounced` Occurs whenever the recipient's mail server **permanently rejected the email**."
- [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits): "Resend retains email data for **30 days** across all plans".

---

## API keys (permission and domain restriction)

**What it is.**
- Keys are bearer tokens with permission `full_access` or `sending_access`.
- A `sending_access` key can optionally be restricted to one verified domain.
- The Node SDK reads `process.env.RESEND_API_KEY` when no key is passed to the constructor. Without either, it throws "Missing API key".
- A key's value is shown only once.

**What it replaces.** Sharing one all-powerful account credential.

**Limits.**
- Key names are at most 50 characters.
- A sending-only key gets `401 restricted_api_key` on non-send endpoints.
- Permission and domain can be edited only in the dashboard. The API can change only the name.

**Sources.**
- [Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key): "`sending_access`: Can only send emails."
- Same page: "Restrict an API key to send emails only from a specific domain. This is only used when the `permission` is set to `sending_access`."
- [Create an API key](https://resend.com/docs/create-an-api-key): "Choose **\"Sending access\"** to grant access to only sending emails unless your key needs full access".
- Same page: "For security reasons, you can only view the API Key once."
- [Send with Node.js](https://resend.com/docs/send-with-nodejs): "The API key must be stored in an environment variable called `RESEND_API_KEY`."
- [Errors](https://resend.com/docs/api-reference/errors): `restricted_api_key`, "Status: 401", "This API key is restricted to only send emails."
- SDK 6.34.1 `dist/index.mjs`: `if (typeof process !== "undefined" && process.env) this.key = process.env.RESEND_API_KEY;` followed by `throw new Error("Missing API key. ...")`.

---

## Send Test Emails (test addresses)

**What it is.** These `@resend.dev` addresses simulate outcomes:
- `delivered@resend.dev`
- `bounced@resend.dev` (SMTP 550 5.1.1)
- `complained@resend.dev`
- `suppressed@resend.dev`

`+label` sub-addressing works on all of them except `suppressed`. `onboarding@resend.dev` works as a test-only `from` address, but before a domain is verified it can only send to your own address. There is no separate sandbox or test-mode API key.

**What it replaces.** Fake SMTP servers or fake addresses such as `@example.com`, which Resend rejects with 422.

**Limits.**
- Test emails count against the sending quota.
- Sends to `example.com` or `test.com` are blocked with `422`.

**Sources.**
- [What email addresses to use for testing?](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing): "`delivered@resend.dev` | Email being delivered" and "`bounced@resend.dev` | Email bouncing".
- Same page: "Resend blocks such addresses and returns a `422 Unprocessable Entity` error if you attempt to send to them."
- Same page: "You can add a label after the `+` symbol ... `delivered+user1@resend.dev`".
- Same page: "The suppressed test email address does not support labeling yet".
- [Send Test Emails](https://resend.com/docs/dashboard/emails/send-test-emails): "Test emails count against your account's sending quota."
- [Errors](https://resend.com/docs/api-reference/errors): "You can only send testing emails to your own email address ... To send emails to other recipients, please verify a domain".
- [Send with Node.js](https://resend.com/docs/send-with-nodejs): "`onboarding@resend.dev` is for testing only."

---

## Implications for calvin

**NFR008 (no duplicates)**
- Pass `{ idempotencyKey: \`${emailType}/${planId}/${committerId}\` }` on every `emails.send`. The six email types give distinct keys, and the format stays well under 256 characters. For the manage link, which goes to the creator, use the creator id or plan id.
- The 24-hour window covers Temporal retries and worker restarts. Once an activity completes, Temporal history records it and the activity is not re-run.
- Idempotency alone does not cover a send retried more than 24 hours later. If that matters, for example a long outage with a large retry backoff, also persist a "sent" marker such as the Resend `data.id` in calvin's store, keyed the same way, and check it first.
- The payload must be byte-identical across retries, otherwise Resend returns `409 invalid_idempotent_request`. Render the subject and body from workflow inputs only: no "now" timestamps or random ids generated inside the activity.
- Treat `409 concurrent_idempotent_requests` as retryable.
- Treat `409 invalid_idempotent_request` as a non-retryable bug.

**Error handling in the activity**
- The SDK returns `{ data, error }` and does not throw for API errors. The activity must convert `error` into a thrown `ApplicationFailure`.
- Retryable: 429 `rate_limit_exceeded`, 409 concurrent, and 5xx. Use Temporal's retry policy, optionally honouring `retry-after`.
- Non-retryable: 400, 401, 403, 422, and 429 `daily_quota_exceeded` / `monthly_quota_exceeded`.
- The SDK has no built-in retry, so Temporal's retry policy is the only retry layer.

**Scheduling**
- Do not use `scheduledAt`. Temporal timers already provide durable delays for the 24-hour and morning reminders.
- `scheduledAt` would add a second source of truth. It would also need the email id stored to cancel when a committer drops out or gets "not this time", is capped at 30 days ahead, and fails if the key is rotated. Sending at timer-fire time keeps cancellation as plain workflow logic.

**NFR009 (SPF/DKIM)**
- Verify a subdomain such as `mail.<domain>`. Add the `send` MX and SPF TXT records and the `resend._domainkey` DKIM TXT record exactly as shown in the dashboard. Verified means SPF and DKIM pass.
- Also add `_dmarc` TXT `v=DMARC1; p=none; rua=...` as a cheap extra.
- Keep the default `send` Return-Path unless there is a reason not to, since it cannot be changed later.

**Volume and quotas**
- About 100 emails in total fits the free tier: 100/day, 3,000/month, 10 req/s.
- Testing and CI sends count toward the quota, so keep CI test sends few, or stub Resend in unit tests and run one smoke test against `delivered+<run>@resend.dev`.

**Email content**
- Plain, text-first: send `text` always, and `html` optionally. No React Email dependency is needed.

**Tracking**
- Add `tags: [{ name: 'email_type', value: 'reminder_24h' }, { name: 'plan_id', value: ... }]`, using only ASCII letters, digits, `_` and `-`.
- Delivered and bounced webhooks exist with signing and replay. They are optional for the PoC: the dashboard logs keep 30 days of history.

**Secrets**
- Set `RESEND_API_KEY` to a `sending_access` key restricted to the calvin domain. `new Resend()` with no argument reads it from the environment.
- Use a separate key per environment, and store the key only once, since its value cannot be shown again.
