# ExcaliDash deployment — excalidash.loftos.io

Stack: `frontend` (nginx, serves the SPA and proxies `/api` + `/socket.io`) → `backend` (Node) → **external PostgreSQL**.

## 1. Database

ExcaliDash supports **SQLite and PostgreSQL only** — MySQL is not usable (see "Why not MySQL" below).

Target: `postgres.prod.loftos.io` → Aurora/RDS PostgreSQL cluster endpoint in `eu-central-1`,
which resolves to a **private VPC address** (`172.31.5.101`). The Docker host must sit inside that
VPC (or a peered/VPN-connected network) and its security group must allow 5432 — otherwise the
backend will fail to start with a connection timeout.

Create the role and database as the RDS **master** user:

```sql
CREATE ROLE excalidash LOGIN PASSWORD '<the password in .env>';

-- On RDS the master user is not a superuser, so it must be a member of the
-- role before it can hand ownership over:
GRANT excalidash TO CURRENT_USER;
CREATE DATABASE excalidash OWNER excalidash;
```

The backend runs its own Prisma migrations on every start, so the role needs full DDL rights on
that database — being the owner covers it. No schema needs to be created by hand.

`DATABASE_URL` in `.env` is already filled in, with `?sslmode=require` so the connection to RDS is
encrypted. To also verify the server certificate, download the
[RDS CA bundle](https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem),
mount it into the backend, and switch to
`?sslmode=verify-full&sslrootcert=/app/certs/rds-ca.pem`.

## 2. Google login

The OAuth client is already configured with the right redirect URI:
`https://excalidash.loftos.io/api/auth/oidc/callback`

In the Google Cloud console for project `caramel-pager-461013-t3`, check the **OAuth consent screen**:

- **User type "Internal"** → only innoloft.com Workspace accounts can sign in. This is what you want.
- **User type "External"** → *any Google account on the internet can sign in* and will be auto-provisioned. ExcaliDash has no domain allowlist, so this is your only place to restrict access.

`AUTH_MODE=oidc_enforced` disables `/auth/login` and `/auth/register` entirely — Google is the only way in.

## 3. Start

```bash
chmod 600 .env
docker compose build --pull
docker compose up -d
docker compose logs -f backend
```

Healthy startup logs the resolved provider and applied migrations.

## 4. Lock down who can log in

`OIDC_FIRST_USER_ADMIN=true` grants ADMIN to **the first account that logs in**. Log in yourself right after the first start, before anyone else reaches the URL.

Once your team has logged in once each, close the door:

```bash
sed -i 's/^OIDC_JIT_PROVISIONING=true/OIDC_JIT_PROVISIONING=false/' .env
docker compose up -d backend
```

After that, only existing users can sign in; new ones are added from the admin UI.

## 5. Reverse proxy

The frontend is published on `127.0.0.1:6767` only, so your host proxy must terminate TLS for `excalidash.loftos.io` and forward there. It must pass `X-Forwarded-Proto` and upgrade WebSockets (`/socket.io/`) — live collaboration depends on it.

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name excalidash.loftos.io;

    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 110M;   # backend accepts 100MB image uploads

    location / {
        proxy_pass http://127.0.0.1:6767;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

`TRUST_PROXY=2` in the compose file assumes this chain (host proxy → frontend nginx → backend). If you ever expose the frontend container directly, drop it to `1`. If your proxy does not forward `X-Forwarded-Proto`, set `ENFORCE_HTTPS_REDIRECT=false` to avoid a redirect loop.

## Why not MySQL

The backend uses Prisma with provider-specific migrations that ship only for SQLite and PostgreSQL (`backend/prisma/migrations/{sqlite,postgresql}`). The container entrypoint hard-rejects anything else:

```
ERROR: DATABASE_PROVIDER must be 'sqlite' or 'postgresql'
```

— `backend/docker-entrypoint.sh:60`, mirrored by a unit test that asserts `mysql` is refused (`backend/src/__tests__/provider-prisma.test.ts:48`). Supporting MySQL would mean forking the project and authoring a third migration set, so Postgres is the right call.

## Operations

```bash
docker compose logs -f backend          # follow logs
docker compose down                     # stop
```

### Upgrade

The stack runs our fork, so images are **built from this checkout** rather than
pulled — `docker compose pull` would fetch upstream images without our changes.
Keep `deploy/` inside the clone (the build contexts are `../backend` and `..`):

```bash
cd /srv/ExcaliDash                 # the clone
git pull --ff-only origin main
cd deploy
docker compose build --pull
docker compose up -d
docker compose logs -f backend
```

The build runs `npm ci` + `tsc` for the backend and a Vite build for the
frontend — budget roughly 2 GB of RAM on the host.

Schema changes need no manual step: the backend entrypoint copies
`prisma/migrations/postgresql/` into place and runs `prisma migrate deploy` on
every start. Confirm one applied with:

```bash
docker compose logs backend | grep -i -A3 "Running database migrations"
```

Back up before upgrading — `pg_dump` for the database plus the
`backend-uploads` volume, which holds uploaded images.
