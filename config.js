/**
 * Configuration for dsh-information.
 *
 * The data model, in one paragraph: the plugin ships **types** (one backend
 * each), the user creates **instances** under a type (an account, an endpoint),
 * a type can be switched off as a whole, and at query time **every requested
 * type runs in parallel while its instances form a fail-over chain** — instance
 * 1 first, instance 2 when instance 1 fails, unless that instance opted out
 * with `onError: 'stop'`.
 *
 * The plugin declares no schemastery schema so it can be installed from a
 * plain workspace package with zero runtime dependencies; `resolveConfig`
 * therefore owns the whole contract. Unknown keys, wrong types, and values
 * that would make a source unusable throw at plugin load instead of silently
 * falling back — a search that quietly answers from the wrong backend is worse
 * than a plugin that refuses to start.
 *
 * @module dsh-information/config
 */

/** Fall-through: a failing instance hands the query to the next one of its type. */
export const ON_ERROR_NEXT = 'next'

/** Abort this type's chain on the first failure, reporting it to the model. */
export const ON_ERROR_STOP = 'stop'

export const ON_ERROR_MODES = Object.freeze([ON_ERROR_NEXT, ON_ERROR_STOP])

/**
 * Default instances: every keyless fact type, one instance each. Web types ship
 * with none on purpose — they all need a key or an endpoint the user owns, and
 * a half-configured web source is worse than an absent one.
 */
export const DEFAULT_INSTANCES = Object.freeze([
  Object.freeze({ id: 'wikipedia', type: 'wikipedia', name: '百科', onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'openalex', type: 'openalex', name: '学术', onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'arxiv', type: 'arxiv', name: '预印本', onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'hackernews', type: 'hackernews', name: '技术讨论', onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'github', type: 'github', name: '代码仓库', onError: ON_ERROR_NEXT }),
  Object.freeze({ id: 'duckduckgo', type: 'duckduckgo', name: '即时回答', onError: ON_ERROR_NEXT }),
])

/**
 * Defaults. `instances` and `disabledTypes` are JSON *strings* because the
 * Loader row config is YAML and nested arrays there would fight the settings
 * editor's whole-object replacement semantics.
 */
export const DEFAULTS = Object.freeze({
  /** JSON array of instances; see the module doc for the shape. */
  instances: JSON.stringify(DEFAULT_INSTANCES.map((instance) => ({ ...instance }))),
  /** JSON array of type ids switched off as a whole category. */
  disabledTypes: '[]',
  /** Result cap per source. */
  maxResults: 5,
  /** Per-instance timeout. */
  timeoutMs: 20000,
})

const KNOWN_KEYS = Object.freeze(Object.keys(DEFAULTS))

const INTEGER_MINIMUMS = Object.freeze({ maxResults: 1, timeoutMs: 1000 })
const INTEGER_MAXIMUMS = Object.freeze({ maxResults: 20, timeoutMs: 120000 })

function fail(message) {
  throw new Error(`dsh-information: ${message}`)
}

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
 * @returns {{ id: string, type: string, name: string, onError: string, baseUrl: string, extra: Record<string, unknown> } | null}
 */
export function normalizeInstance(raw, knownType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw
  const id = str(record.id)
  const type = str(record.type)
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return null
  if (!knownType(type)) return null
  const onError = ON_ERROR_MODES.includes(str(record.onError)) ? str(record.onError) : ON_ERROR_NEXT
  const extra = record.extra && typeof record.extra === 'object' && !Array.isArray(record.extra) ? { ...record.extra } : {}
  return { id, type, name: str(record.name) || id, onError, baseUrl: str(record.baseUrl), extra }
}

/**
 * Parse the `instances` config value.
 *
 * An absent or empty value yields the default instances; an explicit `[]` is
 * respected as "the user cleared the list"; unparseable JSON falls back to the
 * defaults. Ids are de-duplicated so two instances can never share an id (the
 * second would shadow the first in every lookup).
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
  const seen = new Set()
  const out = []
  for (const item of parsed) {
    const instance = normalizeInstance(item, knownType)
    if (instance === null || seen.has(instance.id)) continue
    seen.add(instance.id)
    out.push(instance)
  }
  return out
}

/**
 * Parse the `disabledTypes` value: a JSON array of type ids, unknown ids
 * ignored (a typo must not disable anything by accident).
 *
 * @param {unknown} raw
 * @param {(id: string) => boolean} knownType
 * @returns {string[]}
 */
export function parseDisabledTypes(raw, knownType) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const out = []
  for (const item of parsed) {
    const id = str(item).toLowerCase()
    if (!id || out.includes(id) || !knownType(id)) continue
    out.push(id)
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
    instances: JSON.stringify(instances),
    disabledTypes: JSON.stringify(parseDisabledTypes(config.disabledTypes, knownType)),
    maxResults: config.maxResults,
    timeoutMs: config.timeoutMs,
  })
}
