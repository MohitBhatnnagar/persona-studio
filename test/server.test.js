// API tests for the Persona Studio server. Runs the real server in MOCK mode (no API key,
// no network) on a random port, so every test exercises the actual HTTP behaviour.
// Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

let proc, base, nextIp = 1;

const freePort = () => new Promise((res) => {
  const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // MOCK_MS shortens the simulated per-image delay so the suite runs in seconds.
  proc = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(port), MOCK_MS: "60", OPENAI_API_KEY: "" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((res, rej) => {
    proc.stdout.on("data", (d) => String(d).includes("API on") && res());
    proc.on("exit", (c) => rej(new Error("server exited early: " + c)));
    setTimeout(() => rej(new Error("server did not start")), 10000);
  });
});

after(() => proc?.kill());

// Each call gets its own client IP and id, because the server rate-limits per IP and
// starting a job counts toward a 3-per-hour session limit.
const client = () => ({ "cf-connecting-ip": `10.0.0.${nextIp++}`, "x-client-id": `client-${nextIp}-abcdefgh` });

const png = (bytes = 100) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

function form({ consent = "true", count = "1", file = png() } = {}) {
  const fd = new FormData();
  fd.append("styleId", "ghibli");
  fd.append("styleName", "Ghibli-inspired");
  fd.append("count", count);
  if (consent !== null) fd.append("consent", consent);
  if (file) fd.append("photo", file, "me.png");
  return fd;
}

const post = (headers, body) => fetch(`${base}/api/generate`, { method: "POST", headers, body });
const get = (path, headers = {}) => fetch(base + path, { headers });

async function waitFor(id, headers, until, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const j = await (await get(`/api/jobs/${id}`, headers)).json();
    if (until(j)) return j;
    if (Date.now() > end) throw new Error("timed out waiting for job: " + JSON.stringify(j));
    await new Promise((r) => setTimeout(r, 40));
  }
}

test("health reports ok and mock mode", async () => {
  const j = await (await get("/api/health")).json();
  assert.equal(j.ok, true);
  assert.equal(j.mock, true);
});

test("connection reports mock mode, session cap and no model", async () => {
  const j = await (await get("/api/connection")).json();
  assert.equal(j.mock, true);
  assert.equal(j.model, null);
  assert.equal(j.maxPerSession, 5);
});

test("generate without consent is rejected with 400", async () => {
  const r = await post(client(), form({ consent: null }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /consent/i);
});

test("generate with consent not exactly 'true' is rejected", async () => {
  const r = await post(client(), form({ consent: "yes" }));
  assert.equal(r.status, 400);
});

test("generate without a photo is rejected with 400", async () => {
  const r = await post(client(), form({ file: null }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /photo/i);
});

test("generate with a non-image file type is rejected", async () => {
  const bad = new Blob(["hello"], { type: "text/plain" });
  const r = await post(client(), form({ file: bad }));
  assert.equal(r.status, 400);
});

test("photo larger than 5 MB is rejected with 413", async () => {
  const r = await post(client(), form({ file: png(5_500_000) }));
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /too large/i);
});

test("valid request returns 202 with a job id and total", async () => {
  const r = await post(client(), form({ count: "2" }));
  assert.equal(r.status, 202);
  const j = await r.json();
  assert.ok(j.id && j.jobId === j.id);
  assert.equal(j.total, 2);
});

test("image count is clamped to the 5-per-session maximum", async () => {
  const r = await post(client(), form({ count: "99" }));
  assert.equal((await r.json()).total, 5);
});

test("image count below 1 or invalid falls back to 1", async () => {
  const r = await post(client(), form({ count: "0" }));
  assert.equal((await r.json()).total, 1);
});

test("job completes with the requested number of images and 100% progress", async () => {
  const h = client();
  const { id } = await (await post(h, form({ count: "3" }))).json();
  const j = await waitFor(id, h, (x) => x.status !== "running");
  assert.equal(j.status, "completed");
  assert.equal(j.progress, 100);
  assert.equal(j.images.length, 3);
  assert.equal(j.stage, "Done");
});

test("progress never exceeds 95% while a job is still running", async () => {
  const h = client();
  const { id } = await (await post(h, form({ count: "5" }))).json();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const j = await (await get(`/api/jobs/${id}`, h)).json();
    if (j.status === "running") seen.push(j.progress);
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(seen.length > 0, "expected to observe the running state");
  assert.ok(seen.every((p) => p <= 95), `progress went above 95: ${seen}`);
});

test("image endpoint serves SVG in mock mode; ?dl=1 sets a download filename", async () => {
  const h = client();
  const { id } = await (await post(h, form())).json();
  await waitFor(id, h, (x) => x.status === "completed");
  const r = await get(`/api/jobs/${id}/image/0`, h);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(r.headers.get("cache-control"), /private/);
  const dl = await get(`/api/jobs/${id}/image/0?dl=1`, h);
  assert.match(dl.headers.get("content-disposition"), /attachment; filename="persona-0\.svg"/);
});

test("requesting an image that does not exist returns 404", async () => {
  const h = client();
  const { id } = await (await post(h, form())).json();
  await waitFor(id, h, (x) => x.status === "completed");
  assert.equal((await get(`/api/jobs/${id}/image/9`, h)).status, 404);
});

test("unknown job returns 404 with a helpful message", async () => {
  const r = await get("/api/jobs/does-not-exist");
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /expired/i);
});

test("cancel stops a running job", async () => {
  const h = client();
  const { id } = await (await post(h, form({ count: "5" }))).json();
  await fetch(`${base}/api/jobs/${id}/cancel`, { method: "POST", headers: h });
  const j = await waitFor(id, h, (x) => x.status !== "running");
  assert.equal(j.status, "cancelled");
  assert.ok(j.images.length < 5);
});

test("jobs list shows only the caller's own jobs", async () => {
  const a = client(), b = client();
  const { id: ida } = await (await post(a, form())).json();
  const { id: idb } = await (await post(b, form())).json();
  const listA = await (await get("/api/jobs", a)).json();
  const ids = listA.map((j) => j.id);
  assert.ok(ids.includes(ida));
  assert.ok(!ids.includes(idb));
});

test("a client cannot delete another client's job", async () => {
  const a = client(), b = client();
  const { id } = await (await post(a, form())).json();
  await fetch(`${base}/api/jobs/${id}`, { method: "DELETE", headers: b });
  assert.equal((await get(`/api/jobs/${id}`, a)).status, 200); // still there
  await fetch(`${base}/api/jobs/${id}`, { method: "DELETE", headers: a });
  assert.equal((await get(`/api/jobs/${id}`, a)).status, 404); // owner can delete
});

test("rate limit: the 4th generation session in an hour from one connection returns 429", async () => {
  const h = { "cf-connecting-ip": "203.0.113.77", "x-client-id": "ratelimit-client-1" };
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await post(h, form())).status);
  assert.deepEqual(statuses, [202, 202, 202, 429]);
});

test("rate limit message tells the user what happened", async () => {
  const h = { "cf-connecting-ip": "203.0.113.78", "x-client-id": "ratelimit-client-2" };
  for (let i = 0; i < 3; i++) await post(h, form());
  const r = await post(h, form());
  assert.match((await r.json()).error, /3 sessions per hour/i);
});

test("the rate limit is per connection: a different IP is unaffected", async () => {
  const blocked = { "cf-connecting-ip": "203.0.113.79" };
  for (let i = 0; i < 3; i++) await post(blocked, form());
  assert.equal((await post(blocked, form())).status, 429);
  assert.equal((await post({ "cf-connecting-ip": "203.0.113.80" }, form())).status, 202);
});
