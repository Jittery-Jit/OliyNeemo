# Cloudflare deployment runbook

Neemo deploys as a single OpenNext Worker with a D1 database, an R2 bucket, Workers Assets, two rate-limit bindings, and one secret. `wrangler.jsonc` intentionally omits remote resource IDs and names: current Wrangler versions derive stable resource names from the Worker name and auto-provision D1/R2 on the first deployment.

## 1. Prepare the workstation

Use Node.js 22.13 or newer and the pinned pnpm version:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Create the ignored local secret file:

```bash
cp .dev.vars.example .dev.vars
openssl rand -base64 48
```

Paste that random value after `SESSION_SECRET=` in `.dev.vars`. Use a separate random value for production.

## 2. Validate locally

```bash
pnpm check
SESSION_SECRET="$(openssl rand -base64 48)" pnpm deploy:dry-run
```

The check command includes the dependency audit, builds the OpenNext Worker, and starts it through workerd against a new temporary D1 database created only from committed migrations.

## 3. Bootstrap a new Cloudflare project

The first upload must include the required session secret because Wrangler cannot add a secret to a Worker that does not exist. Create a mode-`0600` temporary file outside the repository, deploy with it, and remove it automatically when the shell exits:

```bash
umask 077
NEEMO_SECRETS_FILE="$(mktemp)"
trap 'unlink "$NEEMO_SECRETS_FILE"' EXIT
node --input-type=module -e "import { randomBytes } from 'node:crypto'; import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], 'SESSION_SECRET=' + randomBytes(48).toString('base64'))" "$NEEMO_SECRETS_FILE"
pnpm build:worker
pnpm exec wrangler deploy --secrets-file "$NEEMO_SECRETS_FILE"
```

That upload provisions the Worker, D1 database, and R2 bucket and installs the production secret in one operation. Immediately apply every remote migration:

```bash
pnpm db:migrate:remote
```

Run the verified release once more so the active Worker has its schema:

```bash
pnpm deploy:cloudflare
```

The default Workers URL is printed by Wrangler. Do not connect a production custom domain until this sequence is complete.

## 4. Verify production

Open the URL in a private browser window and confirm:

1. The landing page loads with no console errors.
2. A private device profile is created.
3. A room can be created and survives a refresh.
4. The Hubs screen shows the current Team ID, cloud broker contract, and browser MQTT connection state.
5. An item image can be uploaded and loaded again.

Inspect live logs while testing:

```bash
pnpm exec wrangler tail
```

Confirm the remote migration state:

```bash
pnpm exec wrangler d1 migrations list DB --remote
```

Run the automated production smoke test. It creates one isolated device profile to prove D1 writes and signed sessions work, but does not create teams, rooms, items, or Hubs:

```bash
NEEMO_DEPLOYMENT_URL=https://your-worker.workers.dev pnpm verify:deployment
```

## 5. Subsequent releases

For normal releases:

```bash
pnpm deploy:cloudflare
```

That command runs every local check, applies pending remote D1 migrations, and deploys the OpenNext Worker. Inspect generated SQL before release. If a schema change cannot coexist briefly with the previous Worker, schedule a direct cutover and avoid serving traffic between the migration and deployment commands.

## 6. Custom domain

Add the hostname from the Worker's **Settings → Domains & Routes** page in the Cloudflare dashboard. Keep the generated `workers.dev` hostname available for diagnosis unless the project has an explicit policy to disable it.

Changing the Worker hostname does not change the scanner firmware broker. The direct MQTT broker remains `neemo.xy.icu:2883`; the browser must still be allowed to connect to `wss://neemo.xy.icu/mqtt`.

## 7. Secret rotation

Rotating `SESSION_SECRET` invalidates every existing device session. This is expected; users receive new private device identities unless account recovery is added later.

```bash
openssl rand -base64 48 | pnpm exec wrangler secret put SESSION_SECRET
```

Do not store the production value in `.dev.vars`, `.env`, documentation, commits, CI logs, or client-side variables.

## 8. Rollback

List deployments and roll back the Worker code with Wrangler:

```bash
pnpm exec wrangler deployments list
pnpm exec wrangler rollback
```

D1 migrations are not automatically reversed by a Worker rollback. Prefer forward fixes. Before a destructive schema migration, export or back up the production database and prepare explicit recovery SQL.

## 9. Resource troubleshooting

If `pnpm db:migrate:remote` says the auto-provisioned database does not exist, the initial OpenNext deployment has not completed for this Worker name. Run the bootstrap deployment first.

If resources were created manually, add their real `database_name`/`database_id` and `bucket_name` to `wrangler.jsonc`, regenerate bindings with `pnpm cf:typegen`, and commit the non-secret resource identifiers.
