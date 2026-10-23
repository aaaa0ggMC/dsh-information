/**
 * HTTP plumbing shared by every source.
 *
 * Two rules keep sources small and tests offline:
 * 1. Every request goes through {@link httpFetch}, which the test suite can
 *    replace with a fake (`__setFetchForTest`). No source ever calls `fetch`
 *    itself, so no test needs a network.
 * 2. Every JSON read goes through {@link readJson}, which turns a non-2xx
 *    response into an error carrying the status and a short body excerpt.
 *    Vendors put the real reason there (invalid key, quota, rate limit), and a
 *    search that fails without that text is undebuggable.
 *
 * @module dsh-information/http
 */

/** Response body excerpt kept in error messages. */
const ERROR_BODY_CHARS = 240

/** @type {((url: string, init?: RequestInit) => Promise<Response>) | null} */
let fetchForTest = null

/**
 * Test seam: install a fake fetch, or pass `null` to restore the real one.
 * @param {((url: string, init?: RequestInit) => Promise<Response>) | null} impl
 */
export function __setFetchForTest(impl) {
  fetchForTest = impl
}

/**
 * One fetch through the injectable seam. Honours `signal` because the tool
 * layer must be able to cancel a slow vendor mid-flight.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function httpFetch(url, init) {
  if (fetchForTest) return fetchForTest(url, init)
  return fetch(url, init)
}

/**
 * @param {unknown} error
 * @returns {string} one-line message for any thrown value.
 */
export function errorText(error) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

/**
 * Read a JSON body, mapping HTTP and parse failures onto one error shape.
 * @param {Response} res
 * @param {string} source Source id, used as the error prefix.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJson(res, source) {
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, ERROR_BODY_CHARS)
    throw new Error(`${source}: HTTP ${res.status}${body ? ` — ${body}` : ''}`)
  }
  try {
    return (await res.json()) ?? {}
  } catch (error) {
    throw new Error(`${source}: invalid JSON response (${errorText(error)})`)
  }
}

/**
 * POST JSON and read JSON back.
 * @param {string} url
 * @param {unknown} body
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function postJson(url, body, options = {}) {
  const res = await httpFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  return readJson(res, options.source ?? 'http')
}

/**
 * GET JSON.
 * @param {string} url
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getJson(url, options = {}) {
  const res = await httpFetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
    signal: options.signal,
  })
  return readJson(res, options.source ?? 'http')
}

/**
 * GET plain text (Atom feeds, HTML scrapes).
 * @param {string} url
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
export async function getText(url, options = {}) {
  const res = await httpFetch(url, {
    method: 'GET',
    headers: { accept: 'text/plain, */*', ...(options.headers ?? {}) },
    signal: options.signal,
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, ERROR_BODY_CHARS)
    throw new Error(`${options.source ?? 'http'}: HTTP ${res.status}${body ? ` — ${body}` : ''}`)
  }
  return res.text()
}

/** @param {unknown} value @returns {string} trimmed string, `''` for anything else. */
export function str(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** @param {unknown} value @returns {unknown[]} the array, or `[]`. */
export function list(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Collapse whitespace and clip. Snippets come from arbitrary web pages; an
 * unbounded one would flood the model context.
 * @param {string} value
 * @param {number} [max]
 * @returns {string}
 */
export function clip(value, max = 600) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** @param {number} value @param {number} min @param {number} max @returns {number} */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
