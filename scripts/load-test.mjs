const target = process.env.LOAD_TEST_URL ?? "http://localhost:3000/api/session";
const total = Number(process.env.LOAD_TEST_REQUESTS ?? 500);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 50);

let nextRequest = 0;
const results = [];

async function worker() {
  while (nextRequest < total) {
    nextRequest += 1;
    const startedAt = performance.now();
    const response = await fetch(target);
    results.push({
      ok: response.ok,
      durationMs: performance.now() - startedAt,
      cookie: response.headers.get("set-cookie"),
    });
    await response.arrayBuffer();
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
const cookies = results.map((result) => result.cookie).filter(Boolean);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] ?? 0;
const summary = {
  target,
  requests: results.length,
  concurrency,
  successful: results.filter((result) => result.ok).length,
  uniqueSessionCookies: new Set(cookies).size,
  p50Ms: Math.round(percentile(0.5)),
  p95Ms: Math.round(percentile(0.95)),
  p99Ms: Math.round(percentile(0.99)),
};

console.log(JSON.stringify(summary, null, 2));
if (summary.successful !== total || summary.uniqueSessionCookies !== total) process.exitCode = 1;
