<!-- AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026. -->
# Deploy Star Shift to Cloudflare Workers

This publishes the static site and its read-only NASA relays. It does not need secrets, a database, a paid plan, or a hard-coded Cloudflare account ID.

## What will be uploaded

`wrangler.toml` can upload only `web/`. That folder currently contains:

- `index.html`, `neo.html`, and `orbits.html`;
- the browser app and the five target presets in `app/`;
- FITS, sky, motion, and archive code in `core/`;
- styles, brand SVGs, star/constellation data, and vendored browser libraries;
- optional verified loader media in `loader/v1.1/` after preparation.

`web/dev/`, source maps, raw folders, unwatermarked filenames, and every `_build/` folder are excluded by `web/.assetsignore`. The raw loader frames at `design/loader/v1.1/_build/` are outside `web/` as a second barrier, so Wrangler cannot upload them.

The astronaut media is not in this checkout. That is safe: the site automatically uses its code-built scan loader. If the approved exports are restored later, put the ten exported media files in `design/loader/v1.1/` together with `watermarked-assets.sha256`. Each non-comment line must be `SHA256  filename`. The preparation script accepts only the exact still, loop, and exit filenames used by the site; verifies every hash; and never reads `_build/`.

## First deployment

Nithil must do the account and browser approval steps personally.

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>. During Workers setup, choose the desired `workers.dev` subdomain. Do not add a payment method for this project.
2. Open PowerShell in the Star Shift repository root.
3. Sign in:

   ```powershell
   npx wrangler login
   ```

4. In the browser page that opens, check that it is Nithil's Cloudflare account, then click **Allow**.
5. Prepare and audit the public files:

   ```powershell
   node deploy/prepare-assets.mjs
   ```

   It must end with `Asset preparation passed.` The script assumes the Workers Free static-asset limits of 20,000 files and 25 MiB per file, and also enforces a conservative 250 MiB total project budget. Cloudflare currently publishes no separate total-byte cap for one static asset version.

6. Deploy:

   ```powershell
   npx wrangler deploy
   ```

7. Copy the URL Wrangler prints. It should look like:

   ```text
   https://star-shift.<your-workers-subdomain>.workers.dev
   ```

Do not put API keys, passwords, tokens, or account IDs in this repository. Wrangler keeps its login outside the project.

## Verify the live deployment

Run this with the exact URL printed by Wrangler:

```powershell
node deploy/smoke-test.mjs https://star-shift.<your-workers-subdomain>.workers.dev
```

The table must have zero failures. It checks the home page, every HTML page in this build, JPL, SPHEREx SIA data for all five targets, a real FITS cutout, relay CORS headers, and that `/loader/v1.1/_build/` returns 404. Pages named `archive`, `spectral`, `proof`, `planetarium`, or `spot` are shown as skipped when they are not present in this build; if any is later added to `web/`, the same script tests it automatically.

## Free-plan limits used here

- Static asset requests are free and unlimited. Relay requests execute Worker code and count toward the Workers Free allowance of **100,000 requests per day**.
- The Free plan allows **20,000 static files per Worker version**, with a maximum of **25 MiB per file**.
- A Worker request has 10 ms of CPU time, 128 MB of memory, and up to 50 outgoing subrequests on the Free plan. Waiting on NASA does not count as CPU time.
- If the Worker request allowance is exhausted, relay calls can return HTTP 429 until the daily allowance resets; matching static pages remain asset requests.

Current official references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static asset billing and limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), and [static asset configuration](https://developers.cloudflare.com/workers/static-assets/binding/).

## Roll back a bad deployment

From the repository root, run:

```powershell
npx wrangler rollback
```

Wrangler selects the version before the latest deployment and asks for confirmation. After it finishes, run the smoke test again against the same public URL. Cloudflare keeps up to the 100 most recent published versions for rollback; see [Cloudflare's rollback guide](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## NASA Space Apps submission

In the submission's **Final Project** field, paste only the live root URL:

```text
https://star-shift.<your-workers-subdomain>.workers.dev
```

Open that exact URL in a private Edge window before submitting it. Do not paste a localhost address, the Cloudflare dashboard URL, or the source repository URL into **Final Project**.

## Local Workers test before deploying (no login, no deploy)

Checked on Sun 15 Nov 2026 by the Coding lead (Claude): wrangler 4 in local mode, no login prompt.

```bash
WRANGLER_SEND_METRICS=false CI=1 npx --yes wrangler@4 dev --port 8797 --ip 127.0.0.1 --show-interactive-dev-session=false
node deploy/smoke-test.mjs http://127.0.0.1:8797
```

- Pick a free port: something else may already listen on 8790 (another session's Python file server did), and then the smoke test silently tests the wrong server.
- Result: 17/17 checks passed (all 8 pages, JPL relay + CORS, the 5 targets' SIA lists, a SPHEREx cutout + CORS, and `_build` blocked with 404).
- `html_handling = "auto-trailing-slash"` answers `/archive.html?q=…` with a 307 to `/archive?q=…`; the query string is kept, so shared links still work.
- Run `node deploy/prepare-assets.mjs` first (it stages the attested loader media into `web/loader/`).
