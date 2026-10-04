# Running the Magic Pages backend

How to set up, configure and run the Magic Pages API (`apps/magic-pages-api-gateway`) locally and in production. Everything here is taken from the code as of 2026-10-04. If you change config, update this file and `.env.example` together.

## 1. What runs

The project is a NestJS monorepo that is in practice a **single monolith**: `apps/magic-pages-api-gateway`. The old `storage` microservice has been folded into the monolith's `upload` module, so there is nothing else to start. Leftover folders such as `apps/books` and `apps/auth` are not used at runtime.

| Item | Value |
|---|---|
| HTTP port | `PORT`, default **8080** |
| API prefix | `/api/v1` (`API_VERSION` sets the `v1` part) |
| Swagger UI | `http://localhost:8080/api/docs` (outside the prefix) |
| Prometheus metrics | served by `@willsoto/nestjs-prometheus` |

## 2. Prerequisites

| Dependency | Version / notes | Required? |
|---|---|---|
| Node.js | 22 (the Dockerfile and GitLab CI both use `node:22`) | yes |
| pnpm | 10.x (`pnpm-lock.yaml` is the lockfile; CI runs `corepack enable && pnpm install --frozen-lockfile`) | yes |
| PostgreSQL | 15 (`docker-compose.yml` uses `postgres:15`) | yes |
| S3-compatible object storage | MinIO locally (`docker-compose.yml`); DigitalOcean Spaces or any S3 API in production | yes, the app checks its buckets at boot |
| RabbitMQ | 3.11 (`docker-compose.rabbitmq.yml`). Carries the e-mail events: OTP, digital delivery, invoices | **yes, in practice** (see the `RABBITMQ_URL` note in section 3) |
| Redis | 7 (`docker-compose.yml`). Used today by the cart (cache and soft stock reservation) and by the cart rate limiter | yes, **for now**. The team plans to remove Redis and move reservation onto Postgres row locks. Do not add new Redis usage. |
| Razorpay account | test keys for development | yes, the only payment gateway (PhonePe and Google Pay have been removed) |
| Mail transport | SMTP server **or** a Resend API key | yes, `MAIL_FROM` and one transport must be set |
| Jaeger / OTLP collector | `docker-compose.otel.yml` | optional, only for `start:otel` |

## 3. Environment variables

### Which file is loaded

- **The app** (`GlobalConfigModule`) loads `.env.${NODE_ENV}`. `NODE_ENV` defaults to `development`, so it reads **`.env.development`**. `pnpm start` and `pnpm start:dev` set `NODE_ENV=development`. The test scripts set `NODE_ENV=test`, which loads `.env.test`.
- **The TypeORM CLI** (`libs/database/data-source.ts`) calls `dotenv.config()`, so it reads **`.env`**, not `.env.development`. Keep `DATABASE_URL` the same in both files, or migrations will run against a different database than the app.
- Variables already set in the shell take precedence over file values.
- Startup validation is done with Joi in `libs/global-config/src/schemas/environment.schema.ts`. A missing required variable stops the app at boot. Some variables are read directly and are not in that schema; the tables mark them.

Start from the template:

```bash
cp .env.example .env.development
cp .env.example .env          # used only by the TypeORM CLI
```

All values in `.env.example` are placeholders. **Never commit a real `.env*` file.**

### App and HTTP

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `NODE_ENV` | yes | `development` | Picks the env file. Also, `production` switches storage URLs to virtual-host style | `development` |
| `PORT` | no | `8080` | HTTP port (not in Joi) | `8080` |
| `API_VERSION` | no | `v1` | Global prefix becomes `api/<API_VERSION>` (not in Joi) | `v1` |
| `CORS_ORIGIN` | recommended | none | Allowed CORS origin, sent with `credentials: true`. **One origin only**, because the string is passed straight to `enableCors` (not in Joi) | `http://localhost:8081` |
| `ORIGIN` | no | none | Fallback used when `CORS_ORIGIN` is unset (not in Joi) | `http://localhost:8081` |
| `FRONTEND_URL` | recommended | `http://localhost:5173` | Storefront base URL used for the payment return redirect and for links in e-mails (digital delivery, invoices, shipping). **The default is wrong for this storefront, which runs on port 8081. Always set it.** (not in Joi) | `http://localhost:8081` |
| `APP_URL` | no | none | Backend public URL. Only used to build a `callbackUrl` that the Razorpay provider currently ignores (not in Joi) | `http://localhost:8080/api/v1` |

### Database

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `DATABASE_URL` | yes | none | Postgres connection URI, used by both the app and the TypeORM CLI | `postgres://postgres:postgres123@localhost:5433/magic-pages` |
| `DATABASE_SYNC` | yes | none | TypeORM `synchronize`. **Must be `false` in production.** See section 5 | `false` |
| `DATABASE_AUTOLOAD` | yes | none | TypeORM `autoLoadEntities`. Keep it `true` | `true` |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | no | `localhost` / `5432` / `postgres` / `postgres` / `magic-pages` | Used by the TypeORM CLI only when `DATABASE_URL` is unset | — |

### Auth: JWT and password hashing

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `JWT_SECRET_KEY` | yes | none | HMAC signing secret, at least 32 characters | `<random-64-char-string>` |
| `JWT_TOKEN_AUDIENCE` | yes | none | `aud` claim | `magic-pages-users` |
| `JWT_TOKEN_ISSUER` | yes | none | `iss` claim | `magic-pages-api` |
| `JWT_ACCESS_TOKEN_TTL` | yes in practice | Joi default `1h` | Access-token lifetime **in seconds**. See gotcha 7.2: never use `1h` | `3600` |
| `HASH_ALGO` | no | `bcrypt` | `bcrypt` or `argon2` | `bcrypt` |
| `BCRYPT_SALT_ROUNDS` | when bcrypt | `10` | 6–15 | `10` |
| `ARGON2_MEMORY_COST` | when argon2 | `65536` | KiB, 8192–262144 | `65536` |
| `ARGON2_TIME_COST` | when argon2 | `5` | 1–10 | `5` |
| `ARGON2_PARALLELISM` | when argon2 | `2` | 1–4 | `2` |

### Payments: Razorpay

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `RAZORPAY_KEY_ID` | yes | none | API key id. The storefront needs the same value as `VITE_RAZORPAY_KEY_ID` | `rzp_test_xxxxxxxxxxxx` |
| `RAZORPAY_KEY_SECRET` | yes | none | API key secret | `<razorpay-key-secret>` |
| `RAZORPAY_WEBHOOK_SECRET` | yes for webhooks | empty | HMAC secret for `X-Razorpay-Signature`. When unset, **every webhook is rejected** and orders settle only through the reconciliation cron | `<webhook-secret>` |

### Shipping

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `SHIPPING_FLAT_RATE_PAISE` | no | `0` | Flat shipping charge in **paise**, applied to any order with a physical line. `0` means free shipping | `4900` |

### E-mail

`MAIL_PROVIDER` decides which block is required. `MAIL_FROM` is always required.

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `MAIL_PROVIDER` | no | `smtp` | `smtp` or `resend` | `resend` |
| `MAIL_FROM` | yes | none | Sender address; must be a valid e-mail | `no-reply@example.com` |
| `MAIL_HOST` | when smtp | none | SMTP host | `smtp.example.com` |
| `MAIL_PORT` | no | `587` | SMTP port | `587` |
| `MAIL_USER` | when smtp | none | SMTP user | `<smtp-user>` |
| `MAIL_PASS` | when smtp | none | SMTP password | `<smtp-password>` |
| `MAIL_SECURE` | no | unset | `true` turns on implicit TLS (port 465) | `false` |
| `RESEND_API_KEY` | when resend | none | Resend API key | `re_xxxxxxxx` |

### Object storage (S3 / MinIO / DigitalOcean Spaces)

| Variable | Required | Default | Purpose | Example (local MinIO) |
|---|---|---|---|---|
| `STORAGE_ENDPOINT` | yes | none | Host, or a full URL. A bare host becomes `http://<host>:<STORAGE_PORT>` | `localhost` |
| `STORAGE_PORT` | yes | `9000` in code | Used only when the endpoint is a bare host | `9000` |
| `STORAGE_USE_SSL` | yes | none | `true` or `false` | `false` |
| `STORAGE_ACCESS_KEY` | yes | none | Access key | `<minio-user>` |
| `STORAGE_SECRET_KEY` | yes | none | Secret key | `<minio-password>` |
| `STORAGE_BUCKET` | yes | none | **Public** bucket (covers and images; anyone can read it) | `magic-pages` |
| `STORAGE_PRIVATE_BUCKET` | no | `<STORAGE_BUCKET>-private` | **Private** bucket for paid ebook and audiobook files. Set it explicitly in production | `magic-pages-private` |
| `STORAGE_REGION` | yes | none | S3 region (MinIO accepts any value) | `us-east-1` |

Buckets are created at boot if they are missing. Public object URLs are path-style (`<endpoint>/<bucket>/<key>`) unless `NODE_ENV=production`, which switches them to virtual-host style (`https://<bucket>.<endpoint>/<key>`).

### Queues: RabbitMQ

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `RABBITMQ_URL` | **yes in practice** (not in Joi) | none | AMQP URL. `RmqModule` reads it with `getOrThrow`, so the app **does not boot without it**, even though `main.ts` logs "email consumer disabled" when it is missing | `amqp://guest:guest@localhost:5672/magic-pages` |
| `RABBITMQ_QUEUE` | no | `magic-pages-queue` | Queue that the **publisher** sends to. The consumer in `main.ts` always listens on `magic-pages-queue`. **Leave this unset or set it to that same name**, otherwise e-mails are published to a queue nobody reads | `magic-pages-queue` |

### Redis (being removed)

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `REDIS_HOST` | yes (Joi) | `localhost` | Cart cache, soft reservation, throttler storage | `localhost` |
| `REDIS_PORT` | no | `6379` | | `6379` |

### Cart

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `CART_CLEANUP_STRATEGY` | no | `cron` | Only `cron` is implemented. `rabbitmq` throws at boot | `cron` |

### Observability (optional)

| Variable | Required | Default | Purpose | Example |
|---|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | `http://localhost:4318/v1/traces` | OTLP trace exporter, read by `otel-bootstrap.js` (`start:otel*` scripts only) | `http://localhost:4318/v1/traces` |

## 4. Start the infrastructure (Docker)

```bash
# Postgres (host port 5433), MinIO (9000 API / 9001 console), Redis (6379)
docker compose up -d

# RabbitMQ (5672 AMQP / 15672 management UI). Also creates the vhost /magic-pages
docker compose -f docker-compose.rabbitmq.yml up -d

# Optional: Jaeger for tracing (UI on 16686)
docker compose -f docker-compose.otel.yml up -d
```

Credentials from the compose files (local development only):

- Postgres: `postgres` / `postgres123`, database `magic-pages`.
- MinIO: `minio` / `minio123`.
- RabbitMQ: `guest` / `guest`, vhost `/magic-pages`. The matching URL is `amqp://guest:guest@localhost:5672/magic-pages`.

The API itself is not run in Docker. The `gateway` service in `docker-compose.yml` is commented out. The `Dockerfile` builds an image (the CI `build` stage pushes it), but its default command is `npm run start:dev`, so set the command explicitly when you run it.

## 5. Database setup and migrations

There are **no migration scripts in `package.json`**. Run the TypeORM CLI directly. The entity files import through `@app/...` path aliases, so `tsconfig-paths/register` is required; without it the CLI fails with `MODULE_NOT_FOUND`:

```bash
# list applied ([X]) and pending ([ ]) migrations
node -r tsconfig-paths/register node_modules/typeorm/cli-ts-node-commonjs.js \
  migration:show -d libs/database/data-source.ts

# apply pending migrations
node -r tsconfig-paths/register node_modules/typeorm/cli-ts-node-commonjs.js \
  migration:run -d libs/database/data-source.ts

# roll back the most recent migration
node -r tsconfig-paths/register node_modules/typeorm/cli-ts-node-commonjs.js \
  migration:revert -d libs/database/data-source.ts
```

The CLI reads `.env` (section 3).

### Fresh database: read this first

The migrations in `libs/database/migrations/` **do not describe the whole schema**. They create the cart, order, payment, transaction, auth (OTP, refresh-token) and invoice tables and alter `users`, but no migration creates `users`, `books`, `book_format_varients`, `categories`, `authors`, `tags`, `age_groups`, `wishlists`, the geo tables, and so on. Those tables have only ever been created by `DATABASE_SYNC=true`.

As a result, neither `migration:run` alone nor sync alone produces a correct database from scratch. The approach that matches how the existing databases were built (not re-verified end to end on an empty database):

1. Create an empty database (the compose Postgres creates `magic-pages`).
2. Boot once with `DATABASE_SYNC=true`. TypeORM creates every table from the entities.
3. Stop the app and record the migrations as applied without running them: `... migration:run --fake -d libs/database/data-source.ts`.
4. Set `DATABASE_SYNC=false` and leave it there. From now on, schema changes go through migrations.

Caveat: step 3 skips anything a migration creates that the entities do not describe, such as raw SQL indexes, triggers and the full-text search index in `AddSearchIndex`. Read through the migrations and apply those parts by hand. A proper baseline migration is still a follow-up.

**Existing database:** run `migration:show`, then `migration:run`. Do not leave `DATABASE_SYNC=true` against a database that has data. Sync can drop or alter columns.

### Seeding and the first admin user

There is no seed script. Catalogue data is created through the admin panel. To create an admin:

1. Register through the storefront, or `POST /api/v1/auth/register`, then verify the OTP with `POST /api/v1/auth/register/verify`. This sets `status = 'ACTIVE'`.
2. Promote the account in SQL:

   ```sql
   UPDATE users SET role = 'ADMIN', status = 'ACTIVE', email_verified_at = COALESCE(email_verified_at, now())
   WHERE email = 'you@example.com';
   ```

3. Log in to the admin panel. It calls `POST /api/v1/admin/auth/login`, which skips the e-mail-verification check but returns 403 for any role other than `ADMIN`.

## 6. Install, run, build, test

```bash
pnpm install

# development (NODE_ENV=development, loads .env.development)
pnpm start:dev          # watch mode
pnpm start              # no watch
pnpm start:debug        # inspector on 9229. Does NOT set NODE_ENV; it falls back to development anyway

# production
pnpm build              # webpack bundle -> dist/apps/magic-pages-api-gateway/main.js
NODE_ENV=production node dist/apps/magic-pages-api-gateway/main
# or, with OpenTelemetry tracing:
pnpm start:otel:prod

# lint / format
pnpm lint
pnpm format
```

**`pnpm start:prod` is broken.** It points at `dist/apps/magic-pages-nest-project/main`, which the build never produces, and it does not set `NODE_ENV`. Use the `node` command above until the script is fixed.

Tests:

```bash
pnpm test:unit          # unit specs (*.spec.ts); no infrastructure needed
pnpm test:integration   # *.int-spec.ts / *.integration-spec.ts; NODE_ENV=test -> .env.test
pnpm test:e2e           # test/e2e; NODE_ENV=test -> .env.test
pnpm test:cov           # coverage
```

The integration and e2e suites that touch real infrastructure expect the throwaway containers in `docker-compose.integration.yml` (Postgres on **5434**, `test`/`test`, database `magic-pages-test`; RabbitMQ on **5673**, vhost `/test`). Point `.env.test` at those ports:

```bash
docker compose -f docker-compose.integration.yml up -d
```

API reference docs: `pnpm doc` runs Compodoc on port 8082 and writes to `./documentation/`, which is git-ignored.

## 7. Known gotchas

### 7.1 Pending orders cancelled during payment (timezone bug, still present)

`OrderTimeoutService.cancelPendingOrders` (`apps/magic-pages-api-gateway/src/cart/services/order-timeout.service.ts`) runs every 5 minutes. It marks orders `FAILED` and releases their stock when `created_at < now - 15 min`. The comparison is wrong whenever the Node process is not running in UTC:

- `orders.created_at` is `TIMESTAMP` **without** time zone, filled by Postgres `now()` in the session time zone (UTC on the compose Postgres).
- The threshold is a JS `Date`. `node-postgres` sends it as a local-time string with an offset (`...+05:30`), and Postgres **drops the offset** when it compares against a `timestamp without time zone` column.
- On a machine set to IST (UTC+5:30), the threshold therefore lands about 5h15m in the future. Every `PENDING` order matches, so a customer can have their order cancelled and their stock released **while they are still on the Razorpay checkout**.

**Workaround:** run the server in UTC:

```bash
TZ=UTC pnpm start:dev
TZ=UTC NODE_ENV=production node dist/apps/magic-pages-api-gateway/main
```

Production containers are usually UTC already. Developer laptops in India are not. The real fix is to compare inside SQL (`created_at < now() - interval '15 minutes'`) or migrate the column to `timestamptz`.

### 7.2 `JWT_ACCESS_TOKEN_TTL` must be a number of seconds

Joi's default is the string `1h`, but `jwt.config.ts` runs `parseInt` on it, and `parseInt('1h')` is `1`. If you leave the variable unset or write `1h`, tokens expire after **one second**. Always set an integer such as `3600`.

### 7.3 CORS allows exactly one origin

`CORS_ORIGIN` is passed to `enableCors` as a single string. The storefront (`http://localhost:8081`) and the admin panel (`http://localhost:3000`) cannot both make direct cross-origin calls at once. Set it to whichever app you are working on. The storefront's Vite dev server also proxies `/api` to `:8080`, but most of its HTTP clients use the absolute `VITE_API_BASE_URL`.

### 7.4 Two env files

The app reads `.env.development`; the migration CLI reads `.env`. See section 3.

### 7.5 PhonePe leftovers

PhonePe has been removed from the code. The committed `phonepe-pg-sdk-node.tgz` tarball in the repo root is dead weight. Historical PhonePe transactions are still readable (`transactions.provider` still accepts `phonepe`). The payment reconciliation cron now polls Razorpay.

## 8. Razorpay webhooks (local testing)

- Endpoint: `POST /api/v1/cart/webhook/payment`. Requests without an `X-Razorpay-Signature` header are rejected with 400. The signature is an HMAC-SHA256 of the **raw** body with `RAZORPAY_WEBHOOK_SECRET`. `main.ts` keeps the raw body for any URL containing `/webhook`.
- Events that settle an order: `payment.captured` and `payment.failed`. Other events are verified and then ignored.
- Without webhooks, the reconciliation cron (every minute) still settles `PENDING` transactions by polling Razorpay. Local checkout therefore works without a tunnel, just more slowly.

To receive real webhooks on a laptop:

```bash
ngrok http 8080
# Razorpay Dashboard (Test mode) -> Settings -> Webhooks -> Add:
#   URL:    https://<ngrok-id>.ngrok-free.app/api/v1/cart/webhook/payment
#   Secret: same value as RAZORPAY_WEBHOOK_SECRET
#   Events: payment.captured, payment.failed
```

## 9. Ports and URLs the frontends expect

| App | Dev URL | Talks to the backend via |
|---|---|---|
| Backend API | `http://localhost:8080/api/v1` | — |
| Storefront (`magic-pages-bookstore-64`, Vite) | `http://localhost:8081` | `VITE_API_BASE_URL` (default `http://localhost:8080/api/v1`) plus the Vite `/api` proxy; `VITE_RAZORPAY_KEY_ID` must match `RAZORPAY_KEY_ID` |
| Admin panel (`the-magic-pages-admin-panel`, Next.js) | `http://localhost:3000` | `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080/api/v1`) |
| Swagger | `http://localhost:8080/api/docs` | — |
| MinIO console | `http://localhost:9001` | — |
| RabbitMQ management | `http://localhost:15672` | — |
| Jaeger UI | `http://localhost:16686` | — |

The storefront routes the backend links to: `/payment/return?orderId=<id>` (after checkout) and `/orders` (links in e-mails). Both are built from `FRONTEND_URL`.
