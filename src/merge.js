/**
 * Cross-source merge: URL normalization, de-duplication and ranking.
 *
 * Ported from the Launcher/YAYA `web-search.ts` module (same author, same
 * semantics) so behaviour that was already exercised in production carries
 * over unchanged:
 *
 * - URLs are normalized before comparison: hash dropped, `utm_*` tracking
 *   parameters dropped, trailing slashes dropped. Without this, the same page
 *   reached through two vendors' redirect URLs counts twice and pushes a real
 *   result out of the top-N.
 * - A URL returned by several sources ranks above a URL returned once:
 *   independent agreement is the cheapest quality signal available.
 * - Remaining order follows each source's own ranking (its best position),
 *   with a stable sort so ties keep the arrival order.
 * - `answer` / `citations` come from the first source that produced an answer,
 *   in the order the caller listed the sources.
 *
 * @module dsh-information/merge
 */

import { clip, list } from './http.js'

/** @typedef {import('./registry.js').SourceHit} SourceHit */
/** @typedef {import('./registry.js').SourceOutput} SourceOutput */

/**
 * Normalize one URL for comparison: drop hash, drop `utm_*`, drop trailing
 * slashes. An unparseable URL is returned as-is so it still de-duplicates
 * against itself.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeUrl(raw) {
  const value = raw.trim()
  if (!value) return ''
  let url
  try {
    url = new URL(value)
  } catch {
    return value
  }
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key)
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}${url.search}`
}

/** @typedef {{ id: string, ok: boolean, error?: string, ms: number }} SourceReport */

/**
 * @typedef {object} MergeInput
 * @property {{ id: string, output: SourceOutput }[]} outputs Sources that returned, in call order.
 * @property {SourceReport[]} reports One report per requested source, in call order.
 */

/**
 * Merge several sources' outputs into one ranked, de-duplicated result.
 *
 * @param {MergeInput} input
 * @param {{ maxResults: number, snippetMax?: number }} options
 * @returns {{ hits: SourceHit[], answer: string | null, citations: { title: string; url: string }[] | undefined, reports: SourceReport[] }}
 */
export function mergeOutputs(input, options) {
  const max = Math.max(1, Math.round(options.maxResults))
  const snippetMax = options.snippetMax ?? 600

  /** @type {Map<string, { hit: SourceHit; engines: string[]; bestRank: number }>} */
  const byKey = new Map()
  /** Insertion order of first sighting, so the sort below is stable. */
  const order = []

  for (const slot of input.outputs) {
    for (const [rank, raw] of list(slot.output.hits).entries()) {
      const url = (raw?.url ?? '').trim()
      if (!url) continue
      const key = normalizeUrl(url)
      if (!key) continue
      const hit = {
        title: clip(raw.title ?? '', 300),
        url,
        snippet: clip(raw.snippet ?? '', snippetMax),
        ...(raw.publishedAt ? { publishedAt: String(raw.publishedAt) } : {}),
      }
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.engines.includes(slot.id)) existing.engines.push(slot.id)
        // Keep the copy from the source that ranked it highest.
        if (rank < existing.bestRank) {
          existing.bestRank = rank
          existing.hit = hit
        }
        continue
      }
      byKey.set(key, { hit, engines: [slot.id], bestRank: rank })
      order.push(key)
    }
  }

  const merged = order.map((key) => byKey.get(key))
  merged.sort((a, b) => b.engines.length - a.engines.length || a.bestRank - b.bestRank)

  let answer = null
  let citations
  for (const slot of input.outputs) {
    const text = typeof slot.output.answer === 'string' ? slot.output.answer.trim() : ''
    if (!text) continue
    answer = text
    const cited = list(slot.output.citations)
      .map((citation) => ({ title: clip(citation?.title ?? '', 200) || hostOf(citation?.url ?? ''), url: (citation?.url ?? '').trim() }))
      .filter((citation) => citation.url)
      .slice(0, max)
    if (cited.length > 0) citations = cited
    break
  }

  return {
    hits: merged.slice(0, max).map((entry) => ({ ...entry.hit, engines: entry.engines })),
    answer,
    ...(citations ? { citations } : {}),
    reports: input.reports,
  }
}

/** @param {string} url @returns {string} hostname, or `''`. */
function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Resolve one source id list from a comma-separated config value, keeping only
 * ids the registry knows and dropping duplicates while preserving order.
 *
 * @param {string} raw Comma-separated ids.
 * @param {(id: string) => boolean} known
 * @returns {{ wanted: string[], unknown: string[] }}
 */
export function parseSourceList(raw, known) {
  /** @type {string[]} */
  const wanted = []
  /** @type {string[]} */
  const unknown = []
  for (const part of String(raw ?? '').split(',')) {
    const id = part.trim().toLowerCase()
    if (!id) continue
    if (wanted.includes(id)) continue
    if (!known(id)) {
      unknown.push(id)
      continue
    }
    wanted.push(id)
  }
  return { wanted, unknown }
}
