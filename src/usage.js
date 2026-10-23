/**
 * Quota / usage reporting for the sources that publish one.
 *
 * Only some vendors expose a quota endpoint (Tavily does; the pay-per-call
 * vendors do not). A source therefore *declares* a `usage` function, and this
 * module owns the discipline around calling it:
 *
 * - Tavily allows ten `/usage` requests per key per ten minutes, so every
 *   answer is cached for two minutes and a 429 backs the key off for ten
 *   minutes (honouring `retry-after`). Without this, opening the settings card
 *   a few times would exhaust the quota endpoint and the card would show
 *   nothing at all.
 * - A failure returns `null`, never throws: the settings card renders "—" and
 *   the search path is untouched.
 *
 * The returned shape is vendor-neutral so the card renders one row shape:
 * `{ used, limit, unit, plan? }` with `limit === null` for "unmetered / unknown".
 *
 * @module dsh-information/usage
 */

/** Fresh answers are served from cache for this long. */
const USAGE_TTL_MS = 120_000

/** Backoff after a 429, when the vendor sends no `retry-after`. */
const USAGE_BACKOFF_MS = 600_000

/** Upstream timeout for one usage probe. */
const USAGE_TIMEOUT_MS = 15_000

/** @type {Map<string, { at: number, details: UsageInfo | null, until?: number }>} */
const cache = new Map()

/**
 * @typedef {object} UsageInfo
 * @property {number} used Consumed amount.
 * @property {number | null} limit Plan limit, when the vendor reports one.
 * @property {string} unit Human unit, e.g. `credits` / `次`.
 * @property {string} [plan] Plan name, when the vendor reports one.
 */

/**
 * Test seam: age every cache entry so the next read is a real upstream call.
 * @param {number} ms
 */
export function ageUsageCache(ms) {
  for (const [key, entry] of cache) cache.set(key, { ...entry, at: entry.at - ms })
}

/**
 * @param {string} ref Credential ref the answer belongs to.
 * @returns {Promise<UsageInfo | null>} the cached-or-fresh usage, or `null`.
 */
export async function readUsage(ref, probe) {
  const cached = cache.get(ref)
  const now = Date.now()
  if (cached !== undefined) {
    if (cached.until !== undefined && now < cached.until) return cached.details
    if (now - cached.at < USAGE_TTL_MS) return cached.details
  }
  try {
    const details = await probe()
    cache.set(ref, { at: Date.now(), details })
    return details
  } catch (error) {
    // A 429 is the vendor protecting its own quota endpoint: back off, keep
    // serving whatever was cached before, and never surface an error to the UI.
    const status = error && typeof error === 'object' ? error.status : undefined
    if (status === 429) {
      const retryAfter = error && typeof error === 'object' ? error.retryAfterMs : undefined
      const waitMs = typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : USAGE_BACKOFF_MS
      const previous = cached?.details ?? null
      cache.set(ref, { at: cached?.at ?? now, details: previous, until: now + waitMs })
      return previous
    }
    return null
  }
}

/**
 * One quota probe against Tavily's usage endpoint.
 *
 * `GET https://api.tavily.com/usage`, Bearer auth. The response nests per-key
 * and per-account numbers, and either side may be missing depending on the key
 * kind, so every field is read from both places with a documented precedence
 * (per-key usage first for `used`, account plan numbers first for the limit).
 *
 * @param {{ key: string, signal?: AbortSignal }} options
 * @returns {Promise<UsageInfo | null>}
 */
export async function tavilyUsage({ key, signal }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.tavily.com/usage', {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: signal ?? controller.signal,
    })
    if (!response.ok) {
      /** @type {{ status: number, retryAfterMs?: number }} */
      const error = { status: response.status }
      if (response.status === 429) {
        const header = Number(response.headers.get('retry-after'))
        error.retryAfterMs = Number.isFinite(header) && header > 0 ? header * 1000 : undefined
      }
      throw error
    }
    const json = (await response.json()) ?? {}
    const account = json.account ?? {}
    const keyUsage = json.key ?? {}
    const used = numberOr(keyUsage.usage) ?? numberOr(account.plan_usage)
    const limit = numberOr(account.plan_limit) ?? numberOr(keyUsage.limit) ?? numberOr(keyUsage.plan_limit)
    const plan = typeof account.plan === 'string' ? account.plan : typeof keyUsage.plan === 'string' ? keyUsage.plan : undefined
    if (used === null) return null
    return { used, limit, unit: 'credits', ...(plan ? { plan } : {}) }
  } finally {
    clearTimeout(timer)
  }
}

/** @param {unknown} value @returns {number | null} */
function numberOr(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
