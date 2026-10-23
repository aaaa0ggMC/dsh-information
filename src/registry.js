/**
 * The dependency-injection container every information source plugs into.
 *
 * Why a registry instead of a switch statement: a new source — a vendor the
 * author never heard of, or a private in-house API — must be addable by
 * appending one object (see `src/sources/`) without touching the search
 * fan-out, the merge, the formatting, the tools, or the settings card. The
 * registry is therefore the only place that knows a source exists; everything
 * else speaks the {@link SourceOutput} vocabulary below.
 *
 * A source is either
 * - `web`  — a web search backend. It is adapted onto dsh's own `ctx.web` seam
 *           (so the built-in `web_search` tool can use it) and is eligible for
 *           the multi-source fan-out behind the `info_search` tool.
 * - `fact` — a structured, usually keyless public data endpoint (Wikipedia,
 *           OpenAlex, arXiv …). It is served by the `info_fetch` tool.
 *
 * Both kinds share one call shape and one result shape, so the merge, the
 * formatter and the tests do not care which kind produced a hit.
 *
 * @module dsh-information/registry
 */

/** One citeable hit, already normalized from whatever the vendor returned. */
// eslint-disable-next-line jsdoc/require-description-complete-sentence

/**
 * @typedef {object} SourceHit
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 * @property {string} [publishedAt] ISO-8601 or vendor date string.
 */

/**
 * @typedef {object} SourceCitation
 * @property {string} title
 * @property {string} url
 */

/**
 * @typedef {object} SourceOutput
 * @property {string} [answer] Provider-generated answer, when the vendor makes one.
 * @property {SourceCitation[]} [citations]
 * @property {SourceHit[]} hits
 */

/**
 * @typedef {object} SourceOptions
 * @property {number} maxResults
 * @property {AbortSignal} [signal]
 * @property {string} [key] Resolved credential for this source, when it needs one.
 * @property {string} [baseUrl] Endpoint override (self-hosted SearXNG, gateways).
 * @property {Record<string, unknown>} [extra] Per-source extras (Google `cx`, Grok `model`…).
 * @property {(url: string, init?: RequestInit) => Promise<Response>} http Injectable for tests.
 */

/**
 * @typedef {object} InformationSource
 * @property {string} id Stable id: config lists, tool arguments and provider ids use it.
 * @property {string} label Human label for the settings card.
 * @property {'web' | 'fact'} kind
 * @property {string} hint One line: what this source is good at, shown to the model and the UI.
 * @property {boolean} keyless True when the source needs no credential at all.
 * @property {string} [credentialRef] Default credentials-store ref, e.g. `TAVILY_API_KEY`.
 * @property {Record<string, unknown>} [defaults] Per-source option defaults (merged into `extra`).
 * @property {(query: string, options: SourceOptions) => Promise<SourceOutput>} search
 */

/** Field names a source object must provide; the rest is optional by contract. */
const REQUIRED_FIELDS = Object.freeze(['id', 'label', 'kind', 'hint', 'keyless', 'search'])

const KINDS = Object.freeze(['web', 'fact'])

function fail(message) {
  throw new Error(`dsh-information: ${message}`)
}

/**
 * Registry of information sources. Registration order is preserved so the
 * settings card, the tool catalog and the fan-out all list sources stably.
 */
export class SourceRegistry {
  /** @type {Map<string, InformationSource>} */
  #sources = new Map()

  /**
   * Register one source. A duplicate id is a programming error, not a
   * deployment choice: silently shadowing a source would make the config list
   * lie about which backend answers.
   * @param {InformationSource} source
   * @returns {() => void} disposer that unregisters it.
   */
  register(source) {
    if (!source || typeof source !== 'object') fail('a source must be an object')
    for (const field of REQUIRED_FIELDS) {
      if (source[field] === undefined) fail(`source is missing "${field}"`)
    }
    if (typeof source.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(source.id)) {
      fail(`source id must match /^[a-z0-9][a-z0-9_-]{0,63}$/, got ${JSON.stringify(source.id)}`)
    }
    if (!KINDS.includes(source.kind)) fail(`source "${source.id}" has unknown kind "${source.kind}"`)
    if (typeof source.search !== 'function') fail(`source "${source.id}" needs a search function`)
    if (this.#sources.has(source.id)) fail(`source "${source.id}" is already registered`)
    this.#sources.set(source.id, source)
    let live = true
    return () => {
      if (!live) return
      live = false
      this.#sources.delete(source.id)
    }
  }

  /** @param {string} id @returns {InformationSource | undefined} */
  get(id) {
    return this.#sources.get(id)
  }

  /** @returns {InformationSource[]} every registered source, in registration order. */
  list() {
    return [...this.#sources.values()]
  }

  /** @param {'web' | 'fact'} kind @returns {InformationSource[]} */
  byKind(kind) {
    return this.list().filter((source) => source.kind === kind)
  }

  /** @returns {string[]} every registered id, in registration order. */
  ids() {
    return [...this.#sources.keys()]
  }

  /** @returns {boolean} whether the id is known. */
  has(id) {
    return this.#sources.has(id)
  }
}
