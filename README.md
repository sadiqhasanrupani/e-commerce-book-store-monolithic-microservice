# Magic Pages API

NestJS backend for the Magic Pages bookstore. It is a monolith: `apps/magic-pages-api-gateway`, built on PostgreSQL and TypeORM, with Razorpay payments, S3/MinIO storage and RabbitMQ for e-mail events. Shared entities and DTOs live in `libs/contract`.

**Setup, environment variables, migrations, running and testing:** see [docs/running-the-backend.md](docs/running-the-backend.md).

Quick start (once `.env.development` and `.env` exist; copy them from `.env.example`):

```bash
pnpm install
docker compose up -d && docker compose -f docker-compose.rabbitmq.yml up -d
TZ=UTC pnpm start:dev          # http://localhost:8080/api/v1, Swagger at /api/docs
```

Other docs are in [`docs/`](docs/).
