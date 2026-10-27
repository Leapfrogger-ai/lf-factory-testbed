# Anthropic API for calvin's meetup suggestion

## Question

calvin (Node/TypeScript PoC) asks Claude Sonnet 5.5, with server-side web search, for one concrete low-stakes meetup plan (format, real venue, date/time, minimum) for a San Francisco Bay Area city, a rough area and a rough time window. The budget is 15s p95 with a hard timeout at 20s, after which the UI falls back to an empty form, and cost must stay tiny. What do the current API and the `@anthropic-ai/sdk` package give us for: the model ID, web search, schema-shaped output, timeouts and retries, caching and rate limits, and API key handling?

## Answer in one sentence

Use `claude-sonnet-5-5` with `web_search_20250305` (`max_uses: 2`, `user_location` set to the city), and return the plan through a `strict: true` client tool under `tool_choice: auto`. Forced tool use returns a 400 on Sonnet 5.5, and the docs never say whether web search works with `output_config.format`. Enforce the 20s limit in the SDK with `timeout: 20_000`, `maxRetries: 0` and an `AbortSignal`, and let the SDK read `ANTHROPIC_API_KEY`.

## Versions (exact, checked 2026-10-27)

| Item | Value |
|---|---|
| Model | Claude Sonnet 5.5, API ID `claude-sonnet-5-5` (status "Active (latest)", released September 28, 2026) |
| Web search tool | `web_search_20250305` (basic), `web_search_20260209` (+ dynamic filtering), `web_search_20260318` (+ `response_inclusion`). All three are current. |
| Structured outputs | `output_config.format` (GA, no beta header); `strict: true` on tools (GA) |
| `@anthropic-ai/sdk` | `1.3.0` (npm `latest`, published 2026-10-23T23:31:47Z); requires Node.js 20 LTS or later |
| API version header | `anthropic-version: 2023-06-01` (the SDK sets it) |

---

## Models: Claude Sonnet 5.5

**What it is.** The mid-tier current model, described as "the best combination of speed and intelligence". Its pinned ID is `claude-sonnet-5-5` (the dateless ID is the snapshot). It is priced at $2 / $10 per MTok in/out, has a 1M context window, and uses adaptive thinking with default effort `high`.

**What it replaces.** Nothing calvin would hand-roll. It matters because it changes how calvin must shape requests:
- `tool_choice` `any` and `tool` return a 400, so the "forced tool call" trick for JSON is not available.
- `thinking: {type: "disabled"}` returns a 400. The lowest thinking setting is `between_tools`.
- `temperature`, `top_p` and `top_k` return a 400.
- Effort (`output_config.effort`) is the latency and cost dial. For latency-sensitive work the docs say to start at `medium` or `low`.

**Limits.** Retirement is not sooner than September 28, 2027. `between_tools` works only at `low`, `medium` or `high` effort.

**Sources**
- https://platform.claude.com/docs/en/about-claude/models/overview: "Claude API ID | ... | `claude-sonnet-5-5`"; "Comparative latency | ... Fast"; "$2 / input MTok, $10 / output MTok"; "Default effort ... `high`".
- https://platform.claude.com/docs/en/models/sonnet-5-5/overview: "Model ID: `claude-sonnet-5-5`"; "Status | Active (latest)"; "Released | September 28, 2026"; "Setting `temperature`, `top_p`, or `top_k` returns a 400 error."
- https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5: "Claude Sonnet 5.5 doesn't support forced tool use. `tool_choice` set to `{\"type\": \"any\"}` or `{\"type\": \"tool\", \"name\": \"...\"}` returns a 400 `invalid_request_error`"; "To turn off up-front thinking on Claude Sonnet 5.5, send `thinking: {\"type\": \"between_tools\"}` instead of `\"disabled\"`."; "For chat and other latency-sensitive work, start at `medium` or `low`."
- https://platform.claude.com/docs/en/build-with-claude/effort: "Set `output_config.effort` on the request."; "`low` | Most efficient. Significant token savings with some capability reduction. | Simpler tasks that need the best speed and lowest costs".

---

## Web search tool

**What it is.** A server tool. The API runs the searches inside the same request, in a server-side loop, and Claude's answer carries citations. Each tool entry takes these parameters:

```json
{ "type": "web_search_20250305", "name": "web_search",
  "max_uses": 2,
  "allowed_domains": ["..."],            // OR blocked_domains, never both (400)
  "user_location": { "type": "approximate", "city": "Oakland",
                     "region": "California", "country": "US",
                     "timezone": "America/Los_Angeles" } }
```

The newer versions add `allowed_callers` and dynamic filtering. On `_20260209` and later, the tool runs from inside code execution by default and filters results before they reach Claude's context. `_20260318` adds `response_inclusion: "excluded"`. Set `allowed_callers: ["direct"]` to turn dynamic filtering off.

**What it replaces.** A hand-rolled venue check: calling Google Places or Yelp, scraping venue pages and passing the results back in a client tool loop. That code is not needed.

**Limits and behaviour**
- **Pricing.** $10 per 1,000 searches ($0.01 each), plus the search results billed as input tokens. Failed searches are not billed. Usage is reported in `usage.server_tool_use.web_search_requests`.
- **`max_uses`.** Going past the cap produces a `web_search_tool_result_error` with `max_uses_exceeded`, still inside a 200 response.
- **Errors arrive in a 200 body.** The codes are `too_many_requests`, `invalid_tool_input`, `max_uses_exceeded`, `query_too_long`, `request_too_large` and `unavailable`. An org that has web search disabled gets a 400 instead.
- **Citations are always on.** They come as `web_search_result_location` items (`url`, `title`, `cited_text` of at most 150 characters, `encrypted_index`) on text blocks. Citation fields do not count as tokens. If the output is shown to end users, citations to the original source must be included.
- **Latency.** The docs give no number. They say only that the stream pauses while a search runs, and that the API can return `stop_reason: "pause_turn"` on a long turn, which needs another request to continue. Treat each search as a large latency cost and measure it.
- **Domain filters.** Entries are bare domains, with no scheme. Request-level `allowed_domains` must fall inside any org-level allow list.
- **Dynamic filtering** (`_20260209` and later) runs through code execution. That adds a step but no extra charge, it is not ZDR-eligible, and on the `_20260209` versions it is the default caller.
- **Structured outputs.** The docs do not say whether web search combines with `output_config.format`. The structured-outputs page lists Citations as incompatible ("The API returns a 400 error if citations are enabled with `output_config.format`"). The citations page scopes that rule to user-provided `document` and `search_result` blocks. Web search citations are "always enabled". **This combination is undocumented, so verify it with one live call before relying on it.** The documented-safe path is below, under Strict tool use.

**Sources**
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool:
  - "Three versions of the web search tool are available: `web_search_20250305`: basic web search; `web_search_20260209`: adds dynamic filtering; `web_search_20260318`: adds response inclusion control"
  - "The `max_uses` parameter limits the number of searches performed. If Claude attempts more searches than allowed, the `web_search_tool_result` is an error with the `max_uses_exceeded` error code."
  - "Simple factual queries typically use 1–3 searches; comparative or multientity research can use 10 or more."
  - "Provide `allowed_domains` or `blocked_domains`, not both. If a request includes both, the API returns a 400 error."
  - "Provide at least one of `city`, `region`, `country`, or `timezone`." / "`type`: The type of location (must be `approximate`)"
  - "Web search is available on the Claude API for **$10 USD per 1,000 searches**, plus standard token costs for search-generated content."
  - "If an error occurs during web search, the web search will not be billed."
  - "Citations are always enabled for web search"; "`cited_text`: Up to 150 characters of the cited content"; "The web search citation fields `cited_text`, `title`, and `url` do not count toward input or output token usage."
  - "When the web search tool encounters an error (such as hitting rate limits), the Claude API still returns a 200 (success) response."
  - "With streaming enabled, you'll receive search events as part of the stream. There is a pause while the search runs"
  - "The API can pause a long-running search turn and return `stop_reason: \"pause_turn\"`."
  - "To call web search directly, without dynamic filtering, set `allowed_callers: [\"direct\"]`."
  - "There are no additional charges for code execution calls made this way beyond the standard token costs."
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools: "The `_20260209` and later versions with dynamic filtering are **not** ZDR-eligible by default because dynamic filtering relies on code execution internally."; "Check `stop_reason` on each response and continue until you get a different stop reason, capping the number of continuations as you would any retry loop."
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs ("Feature compatibility"): "**Citations:** ... The API returns a 400 error if citations are enabled with `output_config.format`."
- https://platform.claude.com/docs/en/build-with-claude/citations: "If you enable citations on any user-provided document (`document` blocks or `search_result` blocks) and also include the `output_config.format` parameter ..., the API returns a 400 error."

---

## Structured outputs (JSON outputs and strict tool use)

**What it is.** Constrained decoding that guarantees output matching a schema. It comes in two GA forms:
- **JSON outputs.** Request parameter `output_config: { format: { type: "json_schema", schema } }`. The JSON comes back in the text block. The old `output_format` parameter is deprecated and works only with the `structured-outputs-2025-11-13` beta header.
- **Strict tool use.** `strict: true` on a tool definition guarantees that the tool's `input` matches its `input_schema`.

TS SDK helpers: `client.messages.parse()` together with `zodOutputFormat(schema)`, or `jsonSchemaOutputFormat(schema)` from `@anthropic-ai/sdk/helpers/json-schema`. The parsed result is in `response.parsed_output`.

**What it replaces.** Prompt-for-JSON, then `JSON.parse`, then a validate-and-retry loop. That code is not needed.

**Limits**
- Objects need `additionalProperties: false`.
- Not supported: `minimum`, `maximum`, `minLength`, `maxLength`, recursive schemas, and array `minItems` above 1.
- At most 24 optional parameters and 16 union-typed parameters across strict schemas, and at most 20 strict tools.
- The first request with a new schema pays for grammar compilation. Compiled grammars are cached for 24h.
- Incompatible with Citations and with prefill.
- `stop_reason: "refusal"` or `"max_tokens"` can produce output that does not match the schema.
- Grammars do not constrain tool calls or tool results. They constrain only Claude's direct output.
- **Sonnet 5.5 cannot force a tool call.** The documented replacement is `tool_choice: auto` plus `strict: true`, with the prompt telling the model when to call the tool, or `output_config.format`.

**The documented-safe pattern for calvin.** Keep `tools: [web_search, propose_plan{strict:true}]` and `tool_choice: auto`. Instruct the model to search, then call `propose_plan` exactly once. calvin reads the `tool_use` block named `propose_plan`; `stop_reason` will be `tool_use`, and calvin does not need to send a result back. Every documented piece of this works with web search. If Claude calls `propose_plan` in the same parallel group as a search, the search is deferred. calvin can accept the plan as returned.

**Sources**
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs:
  - "**JSON outputs** (`output_config.format`) ... **Strict tool use** (`strict: true`): Guarantee schema validation on tool names and inputs."
  - Status: GA on the Claude API. The legacy `output_format` requires the `structured-outputs-2025-11-13` header (from the page's status section).
  - "**First request latency:** The first time you use a specific schema, there is additional latency while the grammar compiles."
  - "**Automatic caching:** Compiled grammars are cached for 24 hours from last use"
  - "**Message prefilling:** Prefilling is incompatible with JSON outputs."
  - "**Grammar scope:** Grammars apply only to Claude's direct output, not to tool use calls, tool results, or thinking tags"
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use: "Setting `strict: true` on a tool definition guarantees Claude's tool inputs match your JSON Schema by constraining the model's token sampling to schema-valid outputs"
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools: "Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, and Claude Mythos 5.1 | `any` and `tool` return a 400 error | `auto` with strict tool use to guarantee schema-valid tool inputs, or structured outputs when you need a response in a fixed JSON shape."
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools: "Claude can call a server tool and a client tool in the same group of parallel tool calls ... the API does not run the server tool. It returns immediately so that you can run the client tool first"
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling: "Tools with `strict: true` are not supported with programmatic calling." This concerns the strict tool's own `allowed_callers`. Leave `propose_plan` at its default of direct.

---

## SDK timeouts, retries and cancellation (`@anthropic-ai/sdk` 1.3.0)

**What it is.** Built-in options on both the client and individual requests:
- `timeout` in ms. The default is 10 minutes, scaled up for large `max_tokens` on non-streaming requests. On expiry the SDK throws `APIConnectionTimeoutError`.
- `maxRetries`. The default is 2, with short exponential backoff. The SDK retries connection errors, 408, 409, 429 and 5xx, and it **also retries timeouts**. It honours `retry-after`, `retry-after-ms` and `x-should-retry`.
- `signal?: AbortSignal` per request. Aborting throws `APIUserAbortError`.

**What it replaces.** Hand-rolled `Promise.race` timers and retry loops.

**Limits.** `timeout` applies to each attempt. Because of the retries, the worst-case wall time is about `timeout × (maxRetries + 1)` plus backoff, so a hard 20s budget needs `maxRetries: 0`. Alternatively, pass an `AbortSignal.timeout(20_000)` that spans all attempts.

**Sources**
- https://platform.claude.com/docs/en/api/sdks/typescript:
  - "Certain errors are automatically retried 2 times by default, with a short exponential backoff. Connection errors ..., 408 Request Timeout, 409 Conflict, 429 Rate Limit, and >=500 Internal errors are all retried by default."
  - "maxRetries: 0 // default is 2"
  - "By default requests time out after 10 minutes."
  - "timeout: 20 * 1000 // 20 seconds (default is 10 minutes)"
  - "On timeout, an `APIConnectionTimeoutError` is thrown."
  - "Note that requests that time out are retried twice by default"
- npm tarball `@anthropic-ai/sdk@1.3.0`, `client.d.ts`: "Note that request timeouts are retried by default, so in a worst-case scenario you may wait much longer than this timeout"; `internal/request-options.d.ts`: "An AbortSignal that can be used to cancel the request. `signal?: AbortSignal`"; `core/error.d.ts` declares `APIUserAbortError`.

---

## API key handling

**What it is.** `new Anthropic()` reads `process.env.ANTHROPIC_API_KEY` by default. Browser use is disabled unless `dangerouslyAllowBrowser: true` is set.

**What it replaces.** Custom key plumbing. The key must stay server-side, so calvin's browser UI calls a calvin server route, never the API directly.

**Sources**
- https://www.npmjs.com/package/@anthropic-ai/sdk (README 1.3.0): "apiKey: process.env['ANTHROPIC_API_KEY'], // This is the default and can be omitted"; "Web browsers: disabled by default to avoid exposing your secret API credentials ... Enable browser support by explicitly setting `dangerouslyAllowBrowser` to `true`."

---

## Prompt caching (minor) and rate limits

**Prompt caching.** Cache reads cost 5% of base input on Sonnet 5.5, and a 5-minute cache write costs 1.25x. The minimum cacheable prefix on Sonnet 5.5 is 512 tokens. calvin's system prompt plus tool definitions may fall below that, and requests are sparse, so the 5-minute TTL would rarely be hit. **Not worth it for the PoC.**
- https://platform.claude.com/docs/en/models/sonnet-5-5/overview: "The minimum cacheable prompt length is 512 tokens."
- https://platform.claude.com/docs/en/about-claude/models/overview: "prompt cache reads cost 10% of the base input price (... 5% on Claude Opus 5.5 and Claude Sonnet 5.5)"
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching: "By default, the cache has a 5-minute lifetime."; "Cache write tokens with a 5-minute TTL are 1.25 times the base input tokens price."

**Rate limits for a new org (Start tier).** For Claude Sonnet 5.5: 1,000 RPM, 2,000,000 ITPM, 400,000 OTPM. The monthly spend cap is $500, and hitting it returns 429. The web search rate limit for the org is shown in the Console. These are far above PoC needs.
- https://platform.claude.com/docs/en/api/rate-limits: "| Claude Sonnet 5.5 | 1,000 | 2,000,000 | 400,000 |" (Start tier tab); "| Start | $500 USD |"; "Once you reach your tier's spend cap, API usage pauses ... API requests return HTTP 429"
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool: "You can see your organization's web search rate limit on the Rate limits page in the Claude Console."

---

## Implications for calvin

- **Model.** Hard-code `model: "claude-sonnet-5-5"`. Do not send `temperature`, `thinking: {type:"disabled"}` or `tool_choice` `any`/`tool`, because each returns a 400 on this model.
- **Latency dial.** Set `output_config: { effort: "low" }` and `thinking: { type: "between_tools" }`. Both are documented as valid together at `low`, and they cut thinking time. Step up to `medium` only if evals show weak plans.
- **Web search config.** `{ type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", city, region: "California", country: "US", timezone: "America/Los_Angeles" } }`. The basic version avoids the code-execution hop that dynamic filtering adds. With `_20260209` or later you would need `allowed_callers: ["direct"]` to get the same effect. Do not set `allowed_domains`: a narrow list would hide venues' own sites. Use `blocked_domains` only if junk sources show up.
- **Recommended `max_uses: 2`** for the 15s p95 and 20s hard budget. The docs say 1–3 searches is typical for simple factual queries. Each search costs an unpublished round trip plus extra input tokens, so cap at 2: one search to find a candidate venue and one to confirm hours. Measure p95 in a spike, and drop to 1 if it exceeds about 12s.
- **Output shape.** Use a client tool `propose_plan` with `strict: true` (format enum, venue name and address, `venue_url`, ISO date-time, minimum attendees) under `tool_choice: auto`. The prompt must say to call it exactly once after searching. Read its `input` as the plan. Combining `output_config.format` with web search is undocumented (possible citations conflict), so verify it with one live call before switching. Keep the schema simple, with no min or max constraints, and validate ranges such as the minimum in code. Expect a one-time grammar compile cost on the first call after deploy or a schema change.
- **Fallbacks.** If no `propose_plan` call arrives, or `stop_reason` is `pause_turn`, `refusal` or `max_tokens`, treat it as a failure and show the empty form. Do not continue a `pause_turn` inside a 20s budget. Web search errors arrive inside a 200, so do not rely on HTTP status alone.
- **Hard 20s limit.** Use `new Anthropic({ maxRetries: 0, timeout: 20_000 })` and pass `{ signal: AbortSignal.timeout(20_000) }` per request. Map `APIConnectionTimeoutError` and `APIUserAbortError` to the empty-form fallback. Keep `maxRetries: 0`: the default of 2 retries would triple the worst case.
- **Citations and venue proof.** Keep the `web_search_result_location` URLs from the response (or have `propose_plan` carry `venue_url`), so the UI can link the venue source. The docs require citing sources when outputs are shown to users.
- **Cost estimate.** These figures are mine and not documented; confirm them in the spike. Two searches cost $0.02. Around 10–20k input tokens of results at $2/MTok cost about $0.02–0.04. About 1k output tokens at $10/MTok cost about $0.01. That is roughly $0.05–0.07 per suggestion. Log `usage` (including `server_tool_use.web_search_requests`) to check.
- **Key.** Set `ANTHROPIC_API_KEY` in the server env only. Never construct the client in the browser.
- **Skip prompt caching** for the PoC: the prefix is likely under 512 tokens and traffic is sparse.
