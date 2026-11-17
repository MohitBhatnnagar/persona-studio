# Persona Studio

Upload one photo, pick a style, get a set of stylised portraits that keep the person's identity. Live at **https://www.mohitstudio.dev**. Built end to end: product definition, UX, a React front end, and a small Node API that owns the image-provider key.

## What it does

- **29 style presets** (anime, watercolor, Ghibli-inspired, cyberpunk, LinkedIn headshot, tarot, medieval, and more), defined in `src/styles.json` with preview art in `public/previews` and thumbnails in `public/thumbs`.
- **Variations:** 1 to 5 images per session. Each image changes outfit, scene, expression, hair and head angle while the prompt pins identity, face structure, age, ethnicity and skin tone.
- **Framing control:** head-and-shoulders, tight close-up, three-quarter body, or a mixed rotation.
- **Asynchronous jobs** with progress, cancel, download, and delete, so the UI never blocks on a slow image API.
- **Mock mode** with no API key, so anyone can run the whole product locally for free.

## Architecture

```
Browser (React + Vite)                    Node API (Express)                 Image provider
 upload photo + style  -- POST /api/generate -->  validate, consent gate
 poll job status       <- GET  /api/jobs/:id --   background worker, one image at a time --> OpenAI images/edits
 show / download       <- GET  /api/jobs/:id/image/:n
```

Key design decisions:

| Decision | Why |
|---|---|
| The provider key lives only in the server environment (`OPENAI_API_KEY`) | A key in front-end code is a leaked key. The browser never sees it. |
| Jobs run in a background loop and the client polls | Image generation takes about a minute per image. A single long HTTP request would time out behind proxies. |
| Progress is computed and eased, capped at 95% until done | The image API reports no real progress. A capped curve avoids a bar that hits 100% and then hangs. |
| Mock mode when no key is set | Zero-cost development, demos and tests. The mock tints the style's preview art per variation. |
| Ownership by a random per-browser `x-client-id` header, falling back to IP | The deployment sits behind Cloudflare, whose edge IPs change per request, so IP alone is an unstable identity. |
| Consent flag required on every generation | The app processes photos of real people, so consent is explicit and enforced server-side, not only in the UI. |

## Safeguards and limits

- Uploads: JPG, PNG or WebP only, 5 MB maximum, one file (`multer` limits, error mapped to HTTP 413).
- Rate limits: 240 requests per minute per client, and 3 generation sessions per hour per connection (HTTP 429 with a readable message).
- Demo budget: a global cap on real images (`DEMO_TOTAL`, default 30) so a public demo cannot run up the bill.
- Job store capped at 60 jobs; oldest evicted first. Images are served with `Cache-Control: private`.

## Run locally

```bash
npm install
npm run dev        # web on :5173, API on :8787, MOCK mode
```

For real images, set the key in the **server** environment only:

```bash
OPENAI_API_KEY=... IMAGE_MODEL=gpt-image-1 npm run dev
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/generate` | Multipart: `photo`, `styleId`, `styleName`, `count`, `view`, `details`, `consent=true`. Returns `202` with a job id. |
| GET | `/api/jobs` | The caller's jobs, newest first. |
| GET | `/api/jobs/:id` | Status, stage, progress, elapsed time, image URLs. |
| GET | `/api/jobs/:id/image/:n` | The image; add `?dl=1` to download. |
| POST | `/api/jobs/:id/cancel` | Stop a running job. |
| DELETE | `/api/jobs/:id` | Delete a job (owner only). |
| GET | `/api/health`, `/api/connection` | Health check and mode/model/remaining demo budget. |

## Tests

**21 API tests, all passing** (about 11 seconds). They start the real server in mock mode on a random port (no API key, no network) and call it over HTTP using Node's built-in test runner, so there are no extra dependencies.

```bash
npm ci --omit=dev
npm test
```

| Area | Tests | What is checked |
|---|---|---|
| Input validation | 5 | Missing or wrong consent, missing photo, non-image file type, photo over 5 MB returns 413 |
| Image count | 2 | Clamped to the 5-per-session maximum; invalid or zero falls back to 1 |
| Job lifecycle | 6 | 202 with job id; job completes with the right number of images at 100%; progress never exceeds 95% while running; SVG served with private cache header and a download filename; missing image and unknown job return 404 |
| Cancel | 1 | Cancelling a running job stops it before all images are made |
| Ownership | 2 | A client sees only its own jobs and cannot delete another client's job |
| Rate limiting | 3 | The 4th session in an hour returns 429 with a clear message; the limit is per connection |
| Health | 2 | Health and connection endpoints report mock mode and limits |

I checked that the tests detect real breakage by temporarily removing the consent check, loosening the rate limit and removing the image-count clamp. Each change made the matching tests fail, and I restored the code afterwards.

For fast tests the server reads an optional `MOCK_MS` environment variable (simulated seconds per image in mock mode, default 2500 ms). The tests set it to 60 ms. It has no effect in real mode.

CI runs the suite on every push (`.github/workflows/ci.yml`).

**Not covered:** the React front end (no component or end-to-end tests), real image-provider calls, and the global demo budget, which only applies in real mode.

## Deploy

`render.yaml` deploys it as a single web service: `npm ci && npm run build`, then `node server/index.js`, with `/api/health` as the health check. The server also serves the built front end.

## Known limitations

- Jobs are held **in memory**. A server restart loses them, and the UI says so. A real deployment would move jobs and images to a database plus object storage and run the worker as a queue consumer.
- Rate limiting is per process, so it would need a shared store such as Redis to scale beyond one instance.
- Likeness quality depends on the provider model. There is no automated image-quality evaluation yet.
- No front-end tests and no real-provider integration tests (see Tests above). A browser-level end-to-end test would be the next step.

## What I learned building it

Defining exactly what an AI step is allowed to do, checking its output, and deciding where a human or a hard limit must step in. The consent gate, caps and mock mode all come from that.
