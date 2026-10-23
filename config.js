/**
 * Configuration for dsh-information.
 *
 * The plugin declares no schemastery schema so it can be installed from a
 * plain workspace package with zero runtime dependencies; `resolveConfig`
 * therefore owns the whole contract. Unknown keys, wrong types, and values
 * that would make a source unusable throw at plugin load instead of silently
 * falling back — a search that quietly answers from the wrong backend is worse
 * than a plugin that refuses to start.
 *
 * The data model (deliberately mirroring the Launcher/YAYA infosource design):
 *
 * - The plugin ships **types** (`src/sources/`): one backend each — `tavily`,
 *   `bocha`, `bigmodel`, `wikipedia`, … A type knows how to talk to one API.
 * - The user creates **instances** in the settings card: `{ id, type, name,
 *   enabled, onError, baseUrl?, extra? }`. Two instances may share a type (two
 *   Tavily accounts, two self-hosted SearXNG mirrors).
 * - Instance **order is the priority**: `chain` mode tries them in order and
 *   falls through on failure — unless an instance says `onError: 'stop'`, which
 *   aborts the whole call so a flaky free tier can never mask a paid one.
 * - Keys never live in this config. Each instance derives a credentials-store
 *   ref from its id (`INFO_<ID>`), which the settings card writes through the
 *   dsh credentials service; `process.env` is the fallback.
 *
 * @module dsh-information/config
 */

/** Fall-through: a failing instance hands the query to the next one. */
export const ON_ERROR_NEXT = 'next'

/** Abort the call on the first failure, reporting it to the model. */
export const ON_ERROR_STOP = 'stop'

export const ON_ERROR_MODES = Object.freeze([ON_ERROR_NEXT, ON_ERROR_STOP])

/** Priority order with fail-over. */
export const MODE_CHAIN = 'chain'

/** Fan out to every enabled instance at once and merge the results. */
export const MODE_MERGE = 'merge'

export const MODES = Object.freeze([MODE_CHAIN, MODE_MERGE])

/** Default instances: every keyless type, one instance each, chain order. */
export const DEFAULT_INSTANCES = Object.freeze([
  Object.freeze({ id: 'wikipedia', type: 'wikipedia', name: 'Wikipedia 概要', enabled: true, onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'openalex', type: 'openalex', name: 'OpenAlex 学术', enabled: true, onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'arxiv', type: 'arxiv', name: 'arXiv 预印本', enabled: true, onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'hackernews', type: 'hackernews', name: 'Hacker News', enabled: true, onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'github', type: 'github', name: 'GitHub 仓库', enabled: true, onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'duckduckgo', type: 'duckduckgo', name: 'DuckDuckGo 即时回答', enabled: true, onError: ON_ERROR_NEXT }),
])

/**
 * Defaults. `instances` is a JSON *string* because the Loader row config is
 * YAML and a nested array there would fight the settings editor's whole-object
 * replacement semantics.
 */
export const DEFAULTS = Object.freeze({
  /** `chain` = priority + failover (default); `merge` = concurrent fan-out. */
  mode: MODE_CHAIN,
  /** JSON array of instances; see the module doc for the shape. */
  instances: JSON.stringify(DEFAULT_INSTANCES.map((instance) => ({ ...instance }))),
  /** Result cap per call. */
  maxResults: 5,
  /** Per-instance timeout in `chain` mode; the wall clock of a `merge` call. */
  timeoutMs: 20000,
})

const KNOWN_KEYS = Object.freeze(Object.keys(DEFAULTS))

const INTEGER_MINIMUMS = Object.freeze({
  maxResults: 1,
  timeoutMs: 1000,
})

const INTEGER_MAXIMUMS = Object.freeze({
  maxResults: 20,
  timeoutMs: 120000,
})

function fail(message) {
  throw new Error(`dsh-information: ${message}`)
}

/**
 * @param {unknown} value
 * @returns {string} trimmed string, `''` for anything else.
 */
function str(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/**
 * Normalize one raw instance record. Anything malformed is dropped rather than
 * guessed at: an instance that silently loses its type would answer from a
 * backend the user never chose.
 *
 * @param {unknown} raw
 * @param {(id: string) => boolean} knownType
 * @returns {{ id: string, type: string, name: string, enabled: boolean, onError: string, baseUrl: string, extra: Record<string, unknown> } | null}
 */
export function normalizeInstance(raw, knownType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw
  const id = str(record.id)
  const type = str(record.type)
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return null
  if (!knownType(type)) return null
  const name = str(record.name) || id
  const onError = ON_ERROR_MODES.includes(str(record.onError)) ? str(record.onError) : ON_ERROR_NEXT
  const extra = record.extra && typeof record.extra === 'object' && !Array.isArray(record.extra) ? { ...record.extra } : {}
  return {
    id,
    type,
    name,
    enabled: record.enabled !== false,
    onError,
    baseUrl: str(record.baseUrl),
    extra,
  }
}

/**
 * Parse the `instances` config value.
 *
 * An absent or empty value yields the default instances; an explicit `[]` is
 * respected as "the user cleared the list"; unparseable JSON falls back to the
 * defaults with the ids de-duplicated so two instances can never share an id
 * (the second would shadow the first in every lookup).
 *
 * @param {unknown} raw
 * @param {(id: string) => boolean} knownType
 * @returns {ReturnType<typeof normalizeInstance>[]}
 */
export function parseInstances(raw, knownType) {
  let parsed = raw
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return DEFAULT_INSTANCES.map((instance) => normalizeInstance(instance, knownType))
  }
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return DEFAULT_INSTANCES.map((instance) => normalizeInstance(instance, knownType))
    }
  }
  if (!Array.isArray(parsed)) {
    return DEFAULT_INSTANCES.map((instance) => normalizeInstance(instance, knownType))
  }
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {ReturnType<typeof normalizeInstance>[]} */
  const out = []
  for (const item of parsed) {
    const instance = normalizeInstance(item, knownType)
    if (instance === null) continue
    if (seen.has(instance.id)) continue
    seen.add(instance.id)
    out.push(instance)
  }
  return out
}

/**
 * Validate one raw Loader row config and merge it over {@link DEFAULTS}.
 * @param {unknown} raw the `config` object of the plugin row, when present.
 * @param {(id: string) => boolean} knownType
 * @returns a frozen, fully resolved configuration.
 */
export function resolveConfig(raw, knownType) {
  const source = raw === undefined || raw === null ? {} : raw
  if (typeof source !== 'object' || Array.isArray(source)) fail('config must be an object')

  for (const key of Object.keys(source)) {
    if (!KNOWN_KEYS.includes(key)) {
      fail(`unknown config key "${key}"; known keys: ${KNOWN_KEYS.join(', ')}`)
    }
  }

  const config = { ...DEFAULTS, ...source }

  if (!MODES.includes(config.mode)) {
    fail(`\`mode\` must be one of ${MODES.join(' / ')}, got ${JSON.stringify(config.mode)}`)
  }
  for (const [key, minimum] of Object.entries(INTEGER_MINIMUMS)) {
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum || config[key] > INTEGER_MAXIMUMS[key]) {
      fail(`\`${key}\` must be an integer in [${minimum}, ${INTEGER_MAXIMUMS[key]}], got ${JSON.stringify(config[key])}`)
    }
  }

  const instances = parseInstances(config.instances, knownType)
  if (instances.length === 0 && config.instances !== '[]') {
    fail('`instances` parsed to an empty list; use "[]" to configure no source at all')
  }

  return Object.freeze({
    mode: config.mode,
    instances: JSON.stringify(instances),
    maxResults: config.maxResults,
    timeoutMs: config.timeoutMs,
  })
}
