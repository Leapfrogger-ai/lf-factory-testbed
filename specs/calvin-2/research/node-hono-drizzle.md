# Node, Hono and Drizzle stack for calvin

## Question

For calvin (a server-rendered Hono app on Node with Neon Postgres, all times in America/Los_Angeles, and a Temporal worker in the same process), what are the current stable versions of Node, Hono, Drizzle, Zod and Vitest? Which native features should we use instead of hand-rolling: TypeScript execution, the `Temporal` date API, Intl time zones, CSRF, secure headers, form parsing, validation, static files, logging, error handling, testing, migrations, upserts, transactions, timestamptz, and unguessable tokens?

## Answer in one sentence

Use Node 26 (it becomes Active LTS on 2026-10-28, ships `Temporal` unflagged, and runs `.ts` natively, but not `.tsx`), Hono 4.13.14 with `@hono/node-server` 2.1.5, the `hono/html` template helper (or hono/jsx plus a build step), `hono/csrf`, `hono/secure-headers` and `@hono/zod-validator` + Zod 4.6.7, Drizzle ORM 0.45.4 / drizzle-kit 0.31.11 on `pg` with `migrate()` at startup, Vitest 5.0.5 with `app.request()`, and `crypto.randomBytes(32).toString('base64url')` for tokens (not `randomUUID`, which has 122 random bits and which the UUID RFC says must not be used as a security capability).

## Versions (exact, checked 2026-10-27)

Versions come from `https://registry.npmjs.org/<pkg>` (`dist-tags.latest`) and `https://nodejs.org/dist/index.json`.

| Package / runtime | Latest stable | Notes |
|---|---|---|
| Node.js 26 | **v26.12.1** (2026-10-21) | Status "Current". Schedule: LTS **2026-10-28**, maintenance 2027-10-20, end of life 2029-04-30. V8 14.6. |
| Node.js 24 "Krypton" | v24.22.1 (2026-10-20) | Labeled "Latest LTS" on nodejs.org, but it entered **Maintenance on 2026-10-20**. End of life 2028-04-30. |
| Node.js 22 "Jod" | v22.23.4 | Maintenance LTS. End of life 2027-04-30. |
| hono | **4.13.14** (2026-10-25) | `next` = 5.0.0-rc.1 (breaking changes, see below). engines `node >=16.9.0` |
| @hono/node-server | **2.1.5** | peer `hono: ^4 \|\| ^5.0.0-0`, engines `node >=20` |
| @hono/zod-validator | **0.9.1** | peer `zod: ^3.25.0 \|\| ^4.0.0`, `hono: >=4.11.2` |
| @hono/standard-validator | 0.4.1 | peer `@standard-schema/spec ^1.0.0` |
| zod | **4.6.7** (2026-10-12) | |
| drizzle-orm | **0.45.4** (2026-10-08) | `rc` = 1.0.0-rc.5, `beta` = 1.0.0-beta.22 |
| drizzle-kit | **0.31.11** (2026-09-21) | `rc` = 1.0.0-rc.5 |
| pg / @types/pg | 8.23.1 / 8.23.1 | engines `node >= 16.0.0` |
| vitest | **5.0.5** (2026-10-15) | engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`, peer `vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| temporal-polyfill | 1.0.6 (2026-10-13) | Only needed on Node < 26 |
| @js-temporal/polyfill | 0.5.1 (2025-03-31) | Only needed on Node < 26 |
| @temporalio/worker (for reference) | 1.24.0 | engines `node >= 20.3.0` |

Source caveats:
- github.com is blocked. The Node schedule dates come from `nodejs/Release/schedule.json` via raw.githubusercontent.com, which nodejs.org/en/about/previous-releases links to as "Full details regarding the Node.js release schedule are available on GitHub". The Node 26.0.0 release post confirms the October LTS date.
- **The Drizzle docs site (orm.drizzle.team) now documents v1.0 RC.** Its install snippets say `drizzle-orm@rc` / `drizzle-kit@rc`. The npm `latest` is still 0.45.4. Where the 0.x API differs (migration folder layout, `migrate()` config), this note says so and checks against the 0.45.4 package's own `.d.ts`.

---

## Node.js

### Release status: "Active LTS" / "Maintenance LTS"

- **What it is:** Even-numbered majors move from Current to Active LTS, then to Maintenance.
- **Status on 2026-10-27:** strictly, no line is in Active LTS today. Node 24 left Active LTS on 2026-10-20 and Node 26 enters it on 2026-10-28. For a PoC starting now, **Node 26** is the right target: it is LTS from tomorrow, supported until 2029-04-30, and the only line with native `Temporal`.
- **Sources:**
  - https://nodejs.org/en/about/previous-releases: "Production applications should only use Active LTS or Maintenance LTS releases." Table: "v 26 - May 05, 2026 Oct 21, 2026 Current", "v 24 Krypton May 06, 2025 Oct 20, 2026 LTS". Footer: "v24.22.1 Latest LTS v26.12.1 Latest Release".
  - Same page: "Historically (up to Node.js 26), odd-numbered releases (9, 11, etc.) become unsupported after six months, and even-numbered releases (10, 12, etc.) move to Active LTS status".
  - https://nodejs.org/en/blog/release/v26.0.0: "As a reminder, Node.js 26 will enter long-term support (LTS) in October".
  - schedule.json (raw.githubusercontent.com/nodejs/Release/main/schedule.json): v24 `"maintenance": "2026-10-20"`; v26 `"lts": "2026-10-28", "end": "2029-04-30"`.

### Type stripping (Modules: TypeScript)

- **What it is:** Node runs `.ts`, `.mts` and `.cts` files directly by replacing type annotations with whitespace. It does no type checking. The docs mark it Stability 2 (Stable) since v24.12.0 / v25.2.0.
- **What it replaces:** `tsx`, `ts-node`, or a `tsc` build step for running the server. Type checking still needs `tsc --noEmit` in CI.
- **Limits:**
  - **`.tsx` is unsupported**, which matters for hono/jsx (see the Hono section).
  - Only erasable syntax works. Enums, namespaces with runtime code, parameter properties and import aliases throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
  - Node 26 removed `--experimental-transform-types`, so there is no escape hatch for that syntax.
  - `tsconfig.json` is ignored, including `paths`. Use `#` subpath imports instead.
  - Type-only imports need the `type` keyword (`verbatimModuleSyntax`).
  - Imports must include the `.ts` extension.
  - Files under `node_modules` are not stripped.
  - Decorators are not supported.
- **Sources:**
  - https://nodejs.org/docs/latest-v26.x/api/typescript.html: "v26.0.0 Removed --experimental-transform-types flag. v25.2.0, v24.12.0 Type stripping is now stable." and "Stability: 2 - Stable".
  - https://nodejs.org/docs/latest-v24.x/api/typescript.html: "By default Node.js will execute TypeScript files that contains only erasable TypeScript syntax. Node.js will replace TypeScript syntax with whitespace, and no type checking is performed."
  - Same page: ".tsx files are unsupported."
  - Same page: "Node.js ignores tsconfig.json files and therefore features that depend on settings within tsconfig.json, such as paths or converting newer JavaScript syntax to older standards, are intentionally unsupported."
  - Same page: "The most prominent features that require transformation are: Enum declarations, namespace with runtime code, parameter properties, import aliases".
  - Same page: "file extensions are mandatory in import statements and import() expressions: import './file.ts', not import './file'".
  - Same page: "Node.js refuses to handle TypeScript files inside folders under a node_modules path."
  - Same page, recommended tsconfig: `"target": "esnext", "module": "nodenext", "rewriteRelativeImportExtensions": true, "erasableSyntaxOnly": true, "verbatimModuleSyntax": true`.

### Temporal (TC39 date/time API, global `Temporal`)

- **What it is:** A built-in date/time API with `Temporal.ZonedDateTime` (an instant plus an IANA zone), `PlainDate`, `PlainDateTime`, `Instant` and `Duration`. It handles DST arithmetic correctly.
- **What it replaces:** `Date` plus libraries like date-fns-tz, luxon or dayjs for "8pm America/Los_Angeles on date X" logic.
- **Availability:** enabled by default in **Node 26.0.0+**. MDN's compat data lists `nodejs` `version_added: "26.0.0"`. It is **not available in Node 24 or 22**. On those, use `temporal-polyfill` 1.0.6 (`import 'temporal-polyfill/global'`, which "Uses native if available") or `@js-temporal/polyfill` 0.5.1.
- **Limits:**
  - MDN still marks Temporal "Limited availability", because Safari only has it in Technology Preview. That doesn't matter server-side, but don't rely on it in calvin's small inline client JS. Format dates on the server.
  - Naming clash risk: the TC39 `Temporal` global and the temporal.io SDK (`@temporalio/*`) share a name. Keep imports explicit to avoid confusing readers.
- **Sources:**
  - https://nodejs.org/en/blog/release/v26.0.0: "The Temporal API is now enabled by default in Node.js 26. Temporal is a modern date/time API for JavaScript that provides a more robust and feature-rich alternative to the legacy Date object."
  - Same page: "The V8 engine is updated to version 14.6.202.33, which is part of Chromium 146."
  - https://bcd.developer.mozilla.org/bcd/api/v0/current/javascript.builtins.Temporal.json (MDN compat data): `nodejs: version_added "26.0.0", release_date "2026-05-05"`; `safari: version_added "preview"`.
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal: "The Temporal object enables date and time management in various scenarios, including built-in time zone and calendar representation, wall-clock time conversions, arithmetics, formatting, and more. It is designed as a full replacement for the Date object."
  - Same MDN page: "Limited availability".
  - npm temporal-polyfill README: "Global polyfill. Uses native if available." and "Only 19.5 kB and spec compliant".

### Internationalization (full-icu)

- **What it is:** The official Node binaries embed full ICU data, so `Intl.DateTimeFormat(..., { timeZone: 'America/Los_Angeles' })` and Temporal time-zone math work without extra packages.
- **What it replaces:** the `full-icu` npm package or `NODE_ICU_DATA`.
- **Limits:** this only applies to official or default builds. A distro Node built with `small-icu` or `system-icu` behaves differently. Use the official image or binary in the Dockerfile.
- **Sources:**
  - https://nodejs.org/docs/latest-v26.x/api/intl.html: "--with-intl=full-icu (default)".
  - https://nodejs.org/docs/latest-v24.x/api/intl.html: "The full ICU data set is provided by Node.js by default."

### crypto.randomBytes / crypto.randomUUID, and Buffer 'base64url'

- **What it is:** a CSPRNG in core. `randomBytes(n)` returns n random bytes. `randomUUID()` returns an RFC 4122 v4 UUID. `Buffer#toString('base64url')` gives URL-safe text without padding.
- **What it replaces:** nanoid or uuid packages.
- **Limits:**
  - A v4 UUID carries **122** random bits: 6 of its 128 bits are fixed version and variant bits.
  - RFC 9562 says UUIDs "MUST NOT be used as security capabilities". calvin's manage and check-in links are exactly that kind of capability.
  - So use `randomBytes(32).toString('base64url')` (256 bits, 43 chars). `randomBytes(16)` (128 bits, 22 chars) is the minimum.
- **Sources:**
  - https://nodejs.org/docs/latest-v24.x/api/crypto.html (`crypto.randomBytes`): "Generates cryptographically strong pseudorandom data. The size argument is a number indicating the number of bytes to generate."
  - Same page (`crypto.randomUUID`): "Generates a random RFC 4122 version 4 UUID. The UUID is generated using a cryptographic pseudorandom number generator."
  - https://www.rfc-editor.org/rfc/rfc9562 §5.4: "an implementation MAY choose to randomly generate the exact required number of bits for random_a, random_b, and random_c (122 bits total) and then concatenate the version and variant in the required position."
  - RFC 9562 §8: "Implementations SHOULD NOT assume that UUIDs are hard to guess. For example, they MUST NOT be used as security capabilities (identifiers whose mere possession grants access)."
  - https://nodejs.org/docs/latest-v24.x/api/buffer.html: "'base64url': base64url encoding as specified in RFC 4648, Section 5. ... When encoding a Buffer to a string, this encoding will omit padding."

---

## Hono

### Node.js adapter (`@hono/node-server`: `serve`, `serveStatic`)

- **What it is:** `serve(app)` wraps `node:http` and returns the server, which you close yourself on SIGTERM. `serveStatic` from `@hono/node-server/serve-static` serves files from disk.
- **What it replaces:** Express or a hand-written `http.createServer` bridge, and a static-file middleware.
- **Limits:**
  - Graceful shutdown is our job. The SIGTERM handler should close the HTTP server and also shut down the Temporal worker.
  - The raw Node request is available at `c.env.incoming`.
- **Sources:**
  - https://hono.dev/docs/getting-started/nodejs: "On Node.js, `serve()` wraps the `node:http` module and returns the underlying server instance, so closing it is up to you."
  - Same page: `import { serveStatic } from '@hono/node-server/serve-static'` and `app.use('/static/*', serveStatic({ root: './' }))`.
  - npm `@hono/node-server@2.1.5` exports: `'.', './utils/*', './conninfo', './early-hints', './serve-static'`.

### html Helper (`hono/html`) and JSX (`hono/jsx`)

- **What it is:**
  - `hono/jsx` is a React-free JSX runtime for rendering HTML on the server (`c.html(<Page/>)`). It hoists `<title>` and `<meta>` into `<head>`.
  - `hono/html` is a tagged template literal that works in plain `.ts`. Interpolated values are escaped, and `raw()` opts out of escaping.
- **What it replaces:** a template engine (EJS, Handlebars) or React SSR.
- **Limits:**
  - **hono/jsx needs `.tsx` files plus `"jsx": "react-jsx", "jsxImportSource": "hono/jsx"`, and Node type stripping refuses `.tsx`.** So either:
    - (a) use `hono/html` templates in `.ts` and keep native TypeScript with no build step, or
    - (b) use JSX and run through `tsx` or a `tsc` build.
  - Vitest transforms `.tsx` itself, so tests aren't the constraint. Production startup is.
  - Escaping: with `html`, never wrap user input in `raw()`. With JSX, never pass user input to `dangerouslySetInnerHTML`.
  - The docs show Open Graph tags built with the `html` helper.
- **Sources:**
  - https://hono.dev/docs/guides/jsx: "You can write HTML with JSX syntax with `hono/jsx`." and the tsconfig `"jsx": "react-jsx", "jsxImportSource": "hono/jsx"`.
  - Same page: "the main file has a `.ts` extension - you need to change it to `.tsx` - otherwise you will not be able to run the application at all."
  - Same page: "These tags will be automatically hoisted to the `<head>` section of the document."
  - https://hono.dev/docs/helpers/html: "The html Helper lets you write HTML in JavaScript template literal with a tag named `html`. Using `raw()`, the content will be rendered as is. You have to escape these strings by yourself."
  - Same page, example: `<meta property="og:title" content="${props.title}">`.
  - Same page: "Since `html` returns an HtmlEscapedString, it can act as a fully functional component without using JSX."

### CSRF Protection (`hono/csrf`)

- **What it is:** middleware that rejects unsafe-method form submissions unless the `Origin` header matches or `Sec-Fetch-Site` is allowed. It needs no tokens in forms.
- **What it replaces:** hand-rolled synchronizer tokens or double-submit cookies.
- **Limits:**
  - It only checks form-type content types on non-GET/HEAD/OPTIONS requests.
  - The default origin is "same origin as the request URL". Behind Fly's TLS-terminating proxy, Node may see `http://` while the browser sends `Origin: https://…`. A request passes if either check passes, so modern browsers still pass on `Sec-Fetch-Site: same-origin` (our inference). Still, set `origin: process.env.PUBLIC_URL` explicitly.
  - Old browsers that send neither header are rejected.
- **Sources:**
  - https://hono.dev/docs/middleware/builtin/csrf: "This middleware protects against CSRF attacks by checking both the `Origin` header and the `Sec-Fetch-Site` header. The request is allowed if either validation passes."
  - Same page: "Use unsafe HTTP methods (not GET, HEAD, or OPTIONS)" and "Have content types that can be sent by HTML forms (`application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`)".
  - Same page: "Old browsers that do not send `Origin` headers, or environments that use reverse proxies to remove these headers, may not work well."
  - Same page: origin "**Default**: Only same origin as the request URL"; secFetchSite "**Default**: Only allows `'same-origin'`".

### Secure Headers Middleware (`hono/secure-headers`)

- **What it is:** Helmet-style defaults: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, COOP/CORP, and removal of `X-Powered-By`. CSP is opt-in, with a `NONCE` helper for inline scripts.
- **What it replaces:** helmet, or setting headers by hand.
- **Limits:**
  - No CSP by default. To lock down the create page's inline JS, set `contentSecurityPolicy` with `scriptSrc: [NONCE]` and put `nonce={c.get('secureHeadersNonce')}` on the `<script>`.
  - `Referrer-Policy: no-referrer` by default is good for token-bearing URLs.
- **Sources:**
  - https://hono.dev/docs/middleware/builtin/secure-headers: "Secure Headers Middleware simplifies the setup of security headers. Inspired in part by the capabilities of Helmet".
  - Same page, table: "referrerPolicy | Referrer-Policy | no-referrer | True"; "contentSecurityPolicy | ... | No Setting".
  - Same page: "You can add a `nonce` attribute to a `script` or `style` element by adding the `NONCE` imported from `hono/secure-headers` to a `scriptSrc` or `styleSrc`".

### parseBody (`c.req.parseBody()`) and Context `redirect()`

- **What it is:** `parseBody()` parses `application/x-www-form-urlencoded` and `multipart/form-data` into an object. `c.redirect(url, status)` sends a redirect.
- **What it replaces:** body-parser.
- **Limits:**
  - Values are `string | File`, and repeated keys need the `foo[]` naming or `{ all: true }`.
  - **`c.redirect()` defaults to 302.** For POST, then redirect, then GET, pass `303` explicitly.
  - There is no body size cap unless you add `hono/body-limit`.
- **Sources:**
  - https://hono.dev/docs/api/request: "Parse Request body of type `multipart/form-data` or `application/x-www-form-urlencoded`" and "`body['foo']` is `(string | File)`."
  - https://hono.dev/docs/api/context: "Redirect, default status code is `302`."
  - https://hono.dev/docs/middleware/builtin/body-limit: "The Body Limit Middleware can limit the file size of the request body."

### Validation (`hono/validator`, Zod Validator Middleware, Standard Schema Validator Middleware)

- **What it is:** `validator('form', fn)` is a thin hook, and `c.req.valid('form')` returns the typed result. Hono recommends a third-party schema library: `@hono/zod-validator` (`zValidator`), or `@hono/standard-validator` (`sValidator`) for any Standard Schema library.
- **What it replaces:** manual `if` checks on parsed bodies.
- **Limits:**
  - The default failure response is a 400, which is wrong for an HTML form. Pass the hook (third argument) to re-render the form with field errors and the user's input.
  - The request must carry the matching `Content-Type`, or the value is `{}`. This matters in tests.
- **Sources:**
  - https://hono.dev/docs/guides/validation: "Hono provides only a very thin Validator." and "We recommend using a third-party validator."
  - Same page: "When you validate `json` or `form`, the request _must_ contain a matching `content-type` header ... Otherwise, the request body will not be parsed and you will receive an empty object (`{}`)".
  - Same page: "The Standard Schema Validator Middleware lets you use any Standard Schema-compatible validation library with Hono".
  - `@hono/zod-validator` 0.9.1 README (npm tarball): "Hook:" `zValidator('json', schema, (result, c) => { if (!result.success) { return c.text('Invalid!', 400) } })`.

### Logger Middleware (`hono/logger`)

- **What it is:** one log line per request and response, with method, path, status and elapsed time.
- **What it replaces:** morgan or pino-http, for a PoC.
- **Limits:**
  - **It logs the request path, so path-embedded secret tokens (manage or check-in links) would land in Fly logs.** Either put tokens in a path segment and pass a custom `PrintFunc` that redacts them, or skip this middleware for token routes.
  - The output is plain text, not structured.
- **Sources:**
  - https://hono.dev/docs/middleware/builtin/logger: "Incoming Request: Logs the HTTP method, request path, and incoming request." and "You can also extend the middleware further by providing your own `PrintFunc` function".

### Error Handling (`app.onError`, `app.notFound`, HTTPException)

- **What it is:** central handlers for uncaught errors and for 404s. Throw `new HTTPException(status, { message | res })` from anywhere.
- **What it replaces:** try/catch in every handler.
- **Limits:**
  - `notFound` only runs on the top-level app.
  - `HTTPException.getResponse()` ignores headers already set on the Context, such as the secure headers.
  - **Hono v5 (5.0.0-rc.1 is on npm) changes the signature to `onError((c) => …c.error…)`.** Pin `hono@^4`.
- **Sources:**
  - https://hono.dev/docs/api/hono: "`app.onError` allows you to handle uncaught errors and return a custom Response." and "The `notFound` method is only called from the top-level app."
  - https://hono.dev/docs/api/exception: "**`HTTPException.getResponse` is not aware of `Context`**. To include headers already set in `Context`, you must apply them to a new `Response`."
  - https://hono.dev/docs/guides/migrating-to-v5: "`onError()` now accepts middleware with the `(c, next)` signature instead of `(err, c)`. Read the error from `c.error`".
  - Same page: "`hono` is published as ESM only." and "On Node.js, version 22.12 or later is required."

### Testing (`app.request()`)

- **What it is:** `app.request(path, init)` dispatches a Request through the app in-process and returns a Response. No server or port is needed.
- **What it replaces:** supertest.
- **Limits:**
  - Set `Content-Type: application/x-www-form-urlencoded` and the body (for example a `URLSearchParams`) for form POSTs.
  - For the CSRF middleware to pass, also send `Origin` or `Sec-Fetch-Site: same-origin`.
- **Sources:**
  - https://hono.dev/docs/guides/testing: "All you need to do is create a Request and pass it to the Hono application to validate the Response. You can then use the useful `app.request` method."
  - Same page, example: `const res = await app.request('/posts'); expect(res.status).toBe(200)`.

---

## Drizzle ORM

### node-postgres driver (`drizzle-orm/node-postgres`)

- **What it is:** `drizzle({ client: new Pool({ connectionString }) })` on `pg`. This gives TCP and full interactive transactions.
- **What it replaces:** raw `pg` queries.
- **Limits:**
  - For a long-running server (Fly), Drizzle points to node-postgres or postgres.js, not neon-http.
  - neon-http is "faster for single, non-interactive transactions" only.
- **Sources:**
  - https://orm.drizzle.team/docs/get-started-postgresql: "Drizzle has native support for PostgreSQL connections with the `node-postgres` and `postgres.js` drivers."
  - Same page, example: `const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const db = drizzle({ client: pool });`.
  - https://orm.drizzle.team/docs/connect-neon: "To use Neon from a serverful environment, you can use the node-postgres or Postgres.js drivers".
  - Same page: "If you need session or interactive transaction support, or a fully compatible drop-in replacement for the `pg` driver, you can use the WebSocket-based `neon-serverless` driver."

### Migrations (`drizzle-kit generate`, `drizzle-kit migrate`, runtime `migrate()`)

- **What it is:**
  - `drizzle-kit generate` diffs the TS schema and writes SQL files to commit.
  - `drizzle-kit migrate` (CLI) or `migrate(db, { migrationsFolder })` (runtime) applies unapplied files and records them in `drizzle.__drizzle_migrations`.
- **What it replaces:** a separate migration tool such as node-pg-migrate.
- **How to run at deploy:** either:
  - Fly `release_command = "npx drizzle-kit migrate"` (see fly-and-neon.md), or
  - `await migrate(db, { migrationsFolder: './drizzle' })` at process start, before `serve()` and before starting the worker. With one Machine, startup migration is simplest.
- **Limits:**
  - In 0.45.4, `migrationsFolder` is **required** (`MigrationConfig { migrationsFolder: string; migrationsTable?; migrationsSchema? }`).
  - The v1 RC changes the folder layout (no `journal.json`) and needs `drizzle-kit up` to convert. Don't mix 0.x and 1.x kit.
  - Avoid `drizzle-kit push` once there is real data.
- **Sources:**
  - https://orm.drizzle.team/docs/migrations: "Drizzle lets you generate SQL migration files based on your schema changes with `drizzle-kit generate` and then you can apply them to the database during runtime of your application."
  - Same page: "This approach is widely used for **monolithic** applications when you apply database migrations during zero downtime deployment".
  - Same page, example: `import { migrate } from 'drizzle-orm/node-postgres/migrator';`.
  - https://orm.drizzle.team/docs/drizzle-kit-migrate: "It will store them in migrations log table named `__drizzle_migrations` in `drizzle` schema."
  - drizzle-orm@0.45.4 `node-postgres/migrator.d.ts`: `migrate(db: NodePgDatabase<TSchema>, config: MigrationConfig): Promise<void>` with `migrationsFolder: string`.
  - https://orm.drizzle.team/docs/upgrade-v1: "We've updated the migrations folder structure by: removing `journal.json` ... To migrate from old structure to a new one you would need to run `drizzle-kit up`".

### Upsert (`onConflictDoUpdate`) and unique indexes

- **What it is:** `insert(...).values(...).onConflictDoUpdate({ target, set })` compiles to `ON CONFLICT ... DO UPDATE`. `target` can be an array for a composite unique key (for example `[rsvps.planId, rsvps.email]`). `set: { name: sql\`excluded.name\` }` takes the incoming value.
- **What it replaces:** a select-then-insert/update race. This implements "same email updates the name".
- **Limits:**
  - The target must match an existing unique constraint or index.
  - For case-insensitive email, Drizzle's guide uses a `uniqueIndex(...).on(lower(email))` expression index. ON CONFLICT then needs that same expression as its target. It's simpler to normalize email to lowercase in the validator and use a plain composite unique.
- **Sources:**
  - https://orm.drizzle.team/docs/guides/upsert: "To implement an upsert query in PostgreSQL ... you can use `.onConflictDoUpdate()` method".
  - https://orm.drizzle.team/docs/insert: "Upsert with composite indexes, or composite primary keys for `onConflictDoUpdate`:" `target: [users.firstName, users.lastName]`.
  - Same page: `set: { name: sql\`excluded.name\` }` with `targetWhere` / `setWhere`.
  - https://orm.drizzle.team/docs/guides/unique-case-insensitive-email: "you can create a unique index on the lowercased `email` column."

### Transactions (`db.transaction`)

- **What it is:** `await db.transaction(async (tx) => { ... })`. It commits on return, rolls back on throw or `tx.rollback()`, supports nested savepoints, and takes `isolationLevel`.
- **What it replaces:** manual `BEGIN`/`COMMIT` on a pooled client.
- **Limits:** needs a session-capable driver (`pg` Pool is fine).
- **Sources:**
  - https://orm.drizzle.team/docs/transactions: "Drizzle ORM provides APIs to run SQL statements in transactions".
  - Same page: "Drizzle ORM supports `savepoints` with nested transactions API".
  - Same page: `isolationLevel?: "read uncommitted" | "read committed" | "repeatable read" | "serializable"`.

### timestamp with time zone (`timestamp({ withTimezone: true, mode })`)

- **What it is:** `timestamp('starts_at', { withTimezone: true, mode: 'date' })` maps `timestamptz` to and from a JS `Date` (an instant). `mode: 'string'` passes raw strings.
- **What it replaces:** manual parsing of `pg` timestamp strings.
- **Limits:**
  - Without `withTimezone`, Postgres "silently ignore[s] any time zone indication". Always use `withTimezone: true`.
  - Store instants (UTC). Convert to and from America/Los_Angeles at the edges with `Temporal`, for example `Temporal.Instant.fromEpochMilliseconds(d.getTime()).toZonedDateTimeISO('America/Los_Angeles')`.
  - Neither Drizzle nor `pg` hands back Temporal objects.
- **Sources:**
  - https://orm.drizzle.team/docs/column-types: `timestamp2: timestamp({ precision: 6, withTimezone: true })` → `"timestamp2" timestamp(6) with time zone`.
  - Same page: "The `date` mode is the regular way to work with dates. Drizzle will take care of all mappings between the database and the JS Date object".
  - Same page, quoting the Postgres docs: "In a literal that has been determined to be timestamp without time zone, PostgreSQL will silently ignore any time zone indication."
  - Same page, also quoting the Postgres docs: "For timestamp with time zone, the internally stored value is always in UTC".

---

## Zod (via Zod Validator Middleware)

- **What it is:** a schema library with static type inference, and the validator Hono's docs recommend.
- **Version:** 4.6.7. `@hono/zod-validator` 0.9.1 accepts `zod ^3.25.0 || ^4.0.0`. It also implements Standard Schema, so `sValidator` works too.
- **Limits:**
  - Form values arrive as strings. Use `z.coerce` or explicit transforms for numbers and booleans (checkbox = present or absent).
  - Trim and lowercase emails in the schema.
- **Sources:**
  - registry.npmjs.org/zod: latest `4.6.7`, description "TypeScript-first schema declaration and validation library with static type inference".
  - https://hono.dev/docs/guides/validation: "You can use Zod, one of third-party validators. We recommend using a third-party validator."

## Vitest

- **What it is:** a Vite-powered test runner. It transforms TS and TSX itself, independently of Node's type stripping.
- **Version:** 5.0.5. engines `^22.12.0 || ^24.0.0 || >=26.0.0`. Peer `vite ^6.4.0 || ^7.0.0 || ^8.0.0`.
- **Limits:** Hono's testing guide uses Vitest with `app.request()`. For DB-backed tests, point `DATABASE_URL` at a Neon branch or a local Postgres.
- **Sources:**
  - registry.npmjs.org/vitest: latest `5.0.5`, description "Next generation testing framework powered by Vite".
  - https://hono.dev/docs/guides/testing: "let's test with Cloudflare Workers and [Vitest]" plus the `app.request` example above.

---

## Implications for calvin

- **Runtime: pin Node 26** (`node:26` image, `"engines": { "node": ">=26.12" }`). It becomes Active LTS on 2026-10-28, is supported until April 2029, and gives native `Temporal` with full ICU, so no date library or polyfill is needed. If something forces Node 24, add `temporal-polyfill` (`import 'temporal-polyfill/global'`).
- **Check that `@temporalio/worker` 1.24.0 supports Node 26.** Its engines field is `>= 20.3.0`, but it ships a native core bridge, so the temporal.io research should confirm Node 26 binaries.
- **Run `.ts` natively and type-check with `tsc --noEmit`.** Use erasable-only syntax: no enums, `import type`, `.ts` extensions in imports, `#` subpath imports instead of `paths`.
- **Templating decision:** use the `hono/html` tagged template in `.ts` files, which keeps the no-build setup. hono/jsx needs `.tsx`, which Node can't strip, so it would add `tsx` or a build step. The pages (create, published, public plan with OG tags, manage, withdraw confirm, check-in landing, not-found) are simple enough for `html`. Never wrap user content in `raw()`.
- **Middleware stack, in order:**
  1. `secureHeaders` with a CSP using `NONCE` for the create page's inline script.
  2. `csrf({ origin: PUBLIC_URL })`.
  3. `bodyLimit`.
  4. Optionally `logger` with a token-redacting `PrintFunc`.
  5. `app.notFound` rendering the not-found page.
  6. `app.onError` rendering a generic error page.
- **Always redirect POST handlers with `c.redirect(url, 303)`.** The default is 302.
- **Validation:** `zValidator('form', schema, hook)`, where the hook re-renders the form with errors and preserved input (status 422/400) instead of the default JSON-ish 400. Normalize email (trim + lowercase) in the schema.
- **Pin `hono@^4` (4.13.14).** Hono 5 RC changes `onError` to `(c) => c.error`, goes ESM-only and needs Node 22.12+. Don't pick it up by accident.
- **Database:**
  - `drizzle-orm@0.45.4` + `drizzle-kit@0.31.11` + `pg` Pool over TCP to Neon. The docs site shows v1 RC syntax, so check examples against the 0.45 `.d.ts`, or deliberately choose `@rc`.
  - Use a composite unique on `(plan_id, email)` with `onConflictDoUpdate({ target: [...], set: { name: sql\`excluded.name\` } })` for "same email updates the name".
  - Wrap multi-row writes in `db.transaction`.
- **Times:**
  - All time columns use `timestamp(..., { withTimezone: true, mode: 'date' })`.
  - Convert at the edges: form input "date + time in LA" → `Temporal.PlainDateTime.from(...).toZonedDateTime('America/Los_Angeles').toInstant()` → `new Date(instant.epochMilliseconds)`. Render with `toZonedDateTimeISO('America/Los_Angeles')` / `Intl.DateTimeFormat`.
  - Do this formatting on the server; Safari lacks Temporal.
- **Migrations:** commit `drizzle-kit generate` output. Apply with `migrate(db, { migrationsFolder: './drizzle' })` at startup before `serve()` and before starting the Temporal worker, or with Fly `release_command`. Choose one.
- **Tokens:** `randomBytes(32).toString('base64url')` for manage and check-in links. Store only a SHA-256 hash if we want DB-leak resistance. Never use `randomUUID()` for these (122 bits, and the RFC forbids UUIDs as security capabilities). `Referrer-Policy: no-referrer` (the secure-headers default) keeps tokens out of Referer headers.
- **Tests:** use Vitest 5.0.5 with `app.request()`. Form POSTs need `Content-Type: application/x-www-form-urlencoded`, and `Sec-Fetch-Site: same-origin` or a matching `Origin` to pass CSRF.
