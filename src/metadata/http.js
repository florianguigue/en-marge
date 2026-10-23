export class ProviderError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// One queue per provider. Retries are bounded, and 429 blocks new calls until retry-after.
export function createHttpClient({
  fetchImpl = fetch,
  intervalMs = 1000,
  timeoutMs = 2000,
  budgetMs = 6000,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let queue = Promise.resolve();
  let nextAt = 0;
  let blockedUntil = 0;
  let queued = 0;
  return (url, options = {}) => {
    if (queued >= 8) return Promise.reject(new ProviderError("busy"));
    queued++;
    const budget = AbortSignal.timeout(budgetMs);
    const task = queue.then(async () => {
      if (budget.aborted) throw new ProviderError("unavailable");
      if (blockedUntil > now()) throw new ProviderError("rate_limited", 429);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (nextAt > now()) await wait(Math.min(nextAt - now(), budgetMs));
        if (budget.aborted) throw new ProviderError("unavailable");
        nextAt = now() + intervalMs;
        let response;
        try {
          response = await fetchImpl(url, {
            ...options,
            headers: {
              "User-Agent": "EnMarge/1.0 (personal book catalogue)",
              Accept: "application/json",
              ...options.headers,
            },
            signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), budget]),
            redirect: "error",
          });
        } catch {
          if (!attempt) continue;
          throw new ProviderError("unavailable");
        }
        if (response.status === 429) {
          const retry = response.headers.get("Retry-After");
          const delay = /^\d+$/.test(retry || "")
            ? Number(retry) * 1000
            : Date.parse(retry) - now();
          blockedUntil =
            now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
          throw new ProviderError("rate_limited", 429);
        }
        if (response.status >= 500 && !attempt) continue;
        if (!response.ok)
          throw new ProviderError(
            response.status === 404 ? "not_found" : "unavailable",
            response.status,
          );
        try {
          return await response.json();
        } catch {
          throw new ProviderError("invalid_response");
        }
      }
    });
    queue = task
      .catch(() => {})
      .finally(() => {
        queued--;
      });
    return new Promise((resolve, reject) => {
      const abort = () => reject(new ProviderError("unavailable"));
      budget.addEventListener("abort", abort, { once: true });
      task
        .then(resolve, reject)
        .finally(() => budget.removeEventListener("abort", abort));
    });
  };
}
