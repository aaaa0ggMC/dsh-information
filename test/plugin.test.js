/**
 * Harness-level integration tests: the plugin's own `apply()` against a
 * minimal fake cordis context, exercising the two tools end to end.
 *
 * These are the tests that pin the two semantic guarantees the settings card
 * promises:
 *
 * 1. **Fail-over inside a type** — instance 1 fails, instance 2 answers.
 * 2. **Independence across sources** — one source failing (including one that
 *    aborts on `onError: 'stop'`) never cancels the other sources of the call.
 *
 * The network is faked through the same seam the unit tests use, so the suite
 * stays offline and deterministic.
 *
 * @module dsh-information/test/plugin
 */

import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'

import { apply } from '../index.js'
import { __setFetchForTest } from '../src/http.js'

/** A fake fetch answering by URL substring, in route order. */
function fakeFetch(routes) {
  return async (url) => {
    const target = String(url)
    for (const [match, response] of routes) {
      if (target.includes(match)) {
        if (response.throw !== undefined) throw response.throw
        const status = response.status ?? 200
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: () => null },
          json: async () => response.body,
          text: async () => JSON.stringify(response.body ?? {}),
        }
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => 'no route' }
  }
}

/** Minimal cordis surface the plugin touches. */
function fakeCtx(secrets = {}) {
  const tools = new Map()
  const providers = new Map()
  const handlers = []
  const credentials = {
    resolve: async (ref) => (secrets[ref] ? { value: secrets[ref], source: 'store' } : undefined),
    set: async () => {},
    unset: async () => {},
    describe: async (ref) => ({ configured: ref in secrets, writable: true }),
  }
  const ctx = {
    credentials,
    tools: { register: (definition) => tools.set(definition.name, definition) },
    web: { registerSearchProvider: (provider) => providers.set(provider.id, provider) },
    get: (name) => (name === 'credentials' ? ctx.credentials : undefined),
    on: () => {},
    effect: (fn) => fn(),
    logger: { warn: () => {}, info: () => {} },
    inject: (_names, callback) =>
      callback({
        connection: { requestRejection: () => undefined },
        webServer: { register: (route) => handlers.push(route.path) },
        configEditor: { entries: () => [] },
        credentials,
        effect: (fn) => fn(),
      }),
  }
  return { ctx, tools, providers, handlers }
}

const WIKI_BODY = {
  query: { pages: { '1': { title: 'Lambda calculus', index: 1, pageid: 1, extract: 'a formalism' } } },
}

before(() => __setFetchForTest(null))

describe('plugin wiring', () => {
  it('registers both tools and the web providers', () => {
    const { ctx, tools, providers, handlers } = fakeCtx()
    apply(ctx, undefined)
    assert.deepEqual([...tools.keys()], ['federated_web_search', 'federated_fact_lookup'])
    assert.equal(providers.has('info-web'), true)
    assert.ok(handlers.includes('/dsh-information/api/settings'))
    // Every tool declares the output contract the registry enforces.
    for (const tool of tools.values()) {
      assert.equal(typeof tool.output.schema, 'object')
      assert.equal(typeof tool.output.render, 'function')
    }
  })
})

describe('federated_fact_lookup', () => {
  it('answers from every default fact source, one section each', async () => {
    __setFetchForTest(
      fakeFetch([
        ['en.wikipedia.org', { body: WIKI_BODY }],
        ['hn.algolia.com', { body: { hits: [{ title: 'HN item', objectID: '7', points: 5, created_at: '2026-01-01T00:00:00Z' }] } }],
        ['api.github.com', { body: { items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b', stargazers_count: 7, language: 'JS' }] } }],
        ['api.duckduckgo.com', { body: { AbstractText: 'an abstract', AbstractURL: 'https://ddg.test' } }],
        ['api.openalex.org', { body: { results: [{ display_name: 'A paper', publication_year: 2020, cited_by_count: 3, doi: 'https://doi.org/10.1/x' }] } }],
        ['export.arxiv.org', { body: '<feed><entry><title>A paper</title><summary>sum</summary><id>http://arxiv.org/abs/1</id><published>2020-01-01</published></entry></feed>' }],
      ]),
    )
    const { ctx, tools } = fakeCtx()
    apply(ctx, undefined)
    const value = await tools.get('federated_fact_lookup').execute(
      { query: 'lambda', sources: ['wikipedia', 'hackernews', 'github', 'duckduckgo', 'openalex', 'arxiv'] },
      { signal: undefined },
    )
    assert.match(value.text, /### Wikipedia 概要/)
    assert.match(value.text, /\*\*Lambda calculus\*\* — a formalism/)
    assert.match(value.text, /### Hacker News/)
    assert.match(value.text, /### GitHub 仓库/)
    assert.match(value.text, /### DuckDuckGo 即时回答/)
    assert.equal(value.sections.length, 6)
    // The registry rejects undeclared output keys at runtime. Pin the fact-hit
    // contract here so a source that starts returning a new field (arXiv's
    // publishedAt did exactly that) fails this test instead of a live call.
    const hitProperties = tools.get('federated_fact_lookup').output.schema.properties.sections.items.properties.hits.items.properties
    for (const section of value.sections) {
      for (const hit of section.hits ?? []) {
        for (const key of Object.keys(hit)) assert.ok(key in hitProperties, `undeclared fact hit property: ${key}`)
      }
    }
    __setFetchForTest(null)
  })

  it('keeps the other sources when one of them fails', async () => {
    __setFetchForTest(
      fakeFetch([
        ['en.wikipedia.org', { body: WIKI_BODY }],
        // Hacker News is down; DuckDuckGo is fine.
        ['hn.algolia.com', { status: 503, body: 'unavailable' }],
        ['api.duckduckgo.com', { body: { AbstractText: 'an abstract' } }],
      ]),
    )
    const { ctx, tools } = fakeCtx()
    apply(ctx, { instances: JSON.stringify([
      { id: 'wiki', type: 'wikipedia', name: '维基', enabled: true },
      { id: 'hn', type: 'hackernews', name: 'HN', enabled: true },
      { id: 'ddg', type: 'duckduckgo', name: 'DDG', enabled: true },
    ]) })
    const value = await tools.get('federated_fact_lookup').execute(
      { query: 'lambda', sources: ['wiki', 'hn', 'ddg'] },
      { signal: undefined },
    )
    // Sections are labelled by type, so the instance names above are irrelevant.
    const byLabel = Object.fromEntries(value.sections.map((section) => [section.label, section]))
    assert.equal(byLabel['Wikipedia 概要'].hits.length, 1)
    assert.equal(byLabel['DuckDuckGo 即时回答'].hits.length, 1)
    // The failed source reports its own error and nothing else is affected.
    assert.match(byLabel['Hacker News'].error, /HTTP 503/)
    assert.equal(value.sections.length, 3)
    __setFetchForTest(null)
  })

  it('stops at the instance that opted out of fail-over', async () => {
    __setFetchForTest(fakeFetch([['en.wikipedia.org', { status: 500, body: 'boom' }]]))
    const { ctx, tools } = fakeCtx()
    apply(ctx, { instances: JSON.stringify([
      { id: 'wiki', type: 'wikipedia', name: '维基', enabled: true, onError: 'stop' },
      { id: 'ddg', type: 'duckduckgo', name: 'DDG', enabled: true },
    ]) })
    const value = await tools.get('federated_fact_lookup').execute({ query: 'x', sources: ['wiki', 'ddg'] }, { signal: undefined })
    const wiki = value.sections.find((section) => section.label === 'Wikipedia 概要')
    assert.match(wiki.error, /HTTP 500/)
    // The other source still ran: stop only ends this source's own chain.
    assert.equal(value.sections.length, 2)
    __setFetchForTest(null)
  })

  it('falls through to the next instance of the same type', async () => {
    let attempt = 0
    __setFetchForTest(async (url) => {
      if (!String(url).includes('en.wikipedia.org')) {
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' }
      }
      attempt += 1
      const body = attempt === 1 ? null : WIKI_BODY
      return {
        ok: body !== null,
        status: body === null ? 500 : 200,
        headers: { get: () => null },
        json: async () => body ?? {},
        text: async () => 'first attempt failed',
      }
    })
    const { ctx, tools } = fakeCtx()
    // Two instances of the SAME type: the first one fails, the second answers.
    apply(ctx, { instances: JSON.stringify([
      { id: 'wiki-a', type: 'wikipedia', name: '维基 A', enabled: true },
      { id: 'wiki-b', type: 'wikipedia', name: '维基 B', enabled: true },
    ]) })
    // Naming one instance selects its type, whose chain is both instances.
    const value = await tools.get('federated_fact_lookup').execute({ query: 'lambda', sources: ['wiki-a'] }, { signal: undefined })
    assert.equal(attempt, 2)
    assert.match(value.text, /\*\*Lambda calculus\*\*/)
    __setFetchForTest(null)
  })

  it('skips an unknown name and reports it (lenient default)', async () => {
    __setFetchForTest(fakeFetch([['en.wikipedia.org', { body: WIKI_BODY }]]))
    const { ctx, tools } = fakeCtx()
    apply(ctx, undefined)
    const value = await tools.get('federated_fact_lookup').execute(
      { query: 'lambda', sources: ['wikipedia', 'nope'] },
      { signal: undefined },
    )
    assert.equal(value.sections.length, 1)
    assert.match(value.text, /已忽略的来源（事实查询）：nope/)
    __setFetchForTest(null)
  })

  it('rejects an unknown name when ignoreUnknownSources is off', async () => {
    const { ctx, tools } = fakeCtx()
    apply(ctx, { ignoreUnknownSources: false })
    await assert.rejects(
      tools.get('federated_fact_lookup').execute({ query: 'lambda', sources: ['wikipedia', 'nope'] }, { signal: undefined }),
      /unknown fact source\(s\): nope/,
    )
  })
})

describe('federated_web_search', () => {
  it('merges two web sources and ranks agreement first', async () => {
    __setFetchForTest(
      fakeFetch([
        ['api.tavily.com', { body: { answer: 'the answer', results: [{ title: 'T', url: 'https://x.test/1', content: 'from tavily' }] } }],
        ['api.bochaai.com', { body: { code: 200, data: { webPages: { value: [{ name: 'B', url: 'https://x.test/1?utm_source=q', summary: 'from bocha' }, { name: 'B2', url: 'https://x.test/2', summary: 'only bocha' }] } } } }],
      ]),
    )
    const { ctx, tools } = fakeCtx({ INFO_TV: 'sk-tv', INFO_BC: 'sk-bc' })
    apply(ctx, { instances: JSON.stringify([
      { id: 'tv', type: 'tavily', name: 'Tavily', enabled: true },
      { id: 'bc', type: 'bocha', name: '博查', enabled: true },
    ]) })
    const value = await tools.get('federated_web_search').execute({ query: 'q', sources: ['tv', 'bc'] }, { signal: undefined })
    assert.equal(value.answer, 'the answer')
    // The URL both sources returned comes first and lists both engines.
    assert.deepEqual(value.sources[0].engines, ['tavily', 'bocha'])
    assert.equal(value.sources[0].snippet, 'from tavily')
    assert.match(value.text, /untrusted information/)
    __setFetchForTest(null)
  })

  it('reports a missing key as that source’s own failure', async () => {
    __setFetchForTest(fakeFetch([['api.tavily.com', { status: 401, body: 'invalid key' }]]))
    const { ctx, tools } = fakeCtx({ INFO_TV: 'sk-test' })
    apply(ctx, { instances: JSON.stringify([{ id: 'tv', type: 'tavily', name: 'Tavily', enabled: true }]) })
    const value = await tools.get('federated_web_search').execute({ query: 'q', sources: ['tv'] }, { signal: undefined })
    assert.match(value.failed[0].error, /tavily: HTTP 401/)
    assert.match(value.text, /「Tavily」没有返回结果/)
    __setFetchForTest(null)
  })

  it('runs every named type in parallel, even when the first one answers', async () => {
    let bochaCalls = 0
    __setFetchForTest(async (url) => {
      const target = String(url)
      if (target.includes('api.tavily.com')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ answer: '', results: [{ title: 'T', url: 'https://t.test', content: 'body' }] }),
          text: async () => '',
        }
      }
      if (target.includes('api.bochaai.com')) {
        bochaCalls += 1
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ code: 200, data: { webPages: { value: [{ name: 'B', url: 'https://b.test', summary: 'body' }] } } }),
          text: async () => '',
        }
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' }
    })
    const { ctx, tools } = fakeCtx({ INFO_TV: 'sk-tv', INFO_BC: 'sk-bc' })
    apply(ctx, { instances: JSON.stringify([
      { id: 'tv', type: 'tavily', name: 'Tavily', enabled: true },
      { id: 'bc', type: 'bocha', name: '博查', enabled: true },
    ]) })
    const value = await tools.get('federated_web_search').execute({ query: 'q', sources: ['tavily', 'bocha'] }, { signal: undefined })
    assert.equal(bochaCalls, 1)
    assert.deepEqual(value.sources.map((source) => source.engines), [['tavily'], ['bocha']])
    __setFetchForTest(null)
  })

  it('skips a whole type when the user disabled it', async () => {
    __setFetchForTest(fakeFetch([['api.tavily.com', { body: { results: [{ title: 'T', url: 'https://t.test', content: 'body' }] } }]]))
    const { ctx, tools } = fakeCtx({ INFO_TV: 'sk-tv', INFO_BC: 'sk-bc' })
    apply(ctx, {
      disabledTypes: '["bocha"]',
      instances: JSON.stringify([
        { id: 'tv', type: 'tavily', name: 'Tavily', enabled: true },
        { id: 'bc', type: 'bocha', name: '博查', enabled: true },
      ]),
    })
    // Naming only the disabled type leaves nothing to run: the call fails,
    // naming the skipped source plus the catalog, so the model can recover.
    await assert.rejects(
      tools.get('federated_web_search').execute({ query: 'q', sources: ['bocha'] }, { signal: undefined }),
      /no usable web information source\. Skipped unknown source\(s\): bocha[\s\S]*`tavily` — Tavily（网页搜索）/,
    )
    const value = await tools.get('federated_web_search').execute({ query: 'q', sources: ['tavily'] }, { signal: undefined })
    assert.deepEqual(value.sources.map((source) => source.engines), [['tavily']])
    __setFetchForTest(null)
  })

  it('returns the catalog instead of searching when no source is named', async () => {
    const { ctx, tools } = fakeCtx()
    apply(ctx, { instances: JSON.stringify([
      { id: 'wiki', type: 'wikipedia', name: '维基', enabled: true },
      { id: 'tv', type: 'tavily', name: 'Tavily', enabled: true },
    ]) })
    const withQuery = await tools.get('federated_fact_lookup').execute({ query: 'lambda' }, { signal: undefined })
    assert.match(withQuery.text, /`wikipedia` — Wikipedia 概要（事实查询）/)
    // A keyed type without a key is deliberately absent from the catalog.
    assert.doesNotMatch(withQuery.text, /Tavily/)
    const bare = await tools.get('federated_web_search').execute({}, { signal: undefined })
    assert.match(bare.text, /要用哪个信息源，请带上 query 与 sources 再调用一次/)
    assert.deepEqual(bare.sources, [])
  })

  it('lists the catalog when the model names only unknown sources', async () => {
    const { ctx, tools } = fakeCtx()
    apply(ctx, { instances: JSON.stringify([{ id: 'sx', type: 'searxng', name: 'SearXNG', enabled: true, baseUrl: 'https://searx.be' }]) })
    await assert.rejects(
      tools.get('federated_web_search').execute({ query: 'q', sources: ['nope'] }, { signal: undefined }),
      /no usable web information source\. Skipped unknown source\(s\): nope[\s\S]*`searxng` — SearXNG（网页搜索）/,
    )
  })

  it('ignores an unknown name but runs the usable sources (lenient default)', async () => {
    __setFetchForTest(
      fakeFetch([['api.tavily.com', { body: { answer: 'the answer', results: [{ title: 'T', url: 'https://x.test/1', content: 'from tavily' }] } }]]),
    )
    const { ctx, tools } = fakeCtx({ INFO_TV: 'sk-tv' })
    apply(ctx, { instances: JSON.stringify([{ id: 'tv', type: 'tavily', name: 'Tavily', enabled: true }]) })
    const value = await tools.get('federated_web_search').execute({ query: 'q', sources: ['tv', 'nope'] }, { signal: undefined })
    assert.equal(value.sources.length, 1)
    assert.match(value.text, /已忽略的来源（网页搜索）：nope/)
    __setFetchForTest(null)
  })

  it('rejects an unknown name when ignoreUnknownSources is off', async () => {
    const { ctx, tools } = fakeCtx({ INFO_TV: 'sk-tv' })
    apply(ctx, {
      ignoreUnknownSources: false,
      instances: JSON.stringify([{ id: 'tv', type: 'tavily', name: 'Tavily', enabled: true }]),
    })
    await assert.rejects(
      tools.get('federated_web_search').execute({ query: 'q', sources: ['tv', 'nope'] }, { signal: undefined }),
      /unknown web source\(s\): nope/,
    )
  })
})

describe('credentials mounted after the plugin', () => {
  /**
   * The Loader reconciles layers asynchronously, so `credentials` can be
   * mounted after this row applies. A handle captured at apply time is then
   * `undefined` forever: every key the settings card writes is stored, yet
   * every read comes back empty and the keyed sources stay out of the catalog
   * for the life of the process — the "saved but never used" bug.
   */
  function lateCtx(secrets) {
    const tools = new Map()
    const store = {
      resolve: async (ref) => (secrets[ref] ? { value: secrets[ref], source: 'file' } : undefined),
      set: async (ref, value) => {
        secrets[ref] = value
      },
      unset: async (ref) => {
        delete secrets[ref]
      },
    }
    const pending = []
    const ctx = {
      // Not mounted yet when the row applies.
      get: () => undefined,
      tools: { register: (definition) => tools.set(definition.name, definition) },
      web: { registerSearchProvider: () => {} },
      on: () => {},
      effect: (fn) => fn(),
      logger: { warn: () => {}, info: () => {} },
      inject: (names, callback) => {
        pending.push({ names, callback })
      },
    }
    return { ctx, tools, store, pending }
  }

  it('uses a key written after apply without a restart', async () => {
    __setFetchForTest(
      fakeFetch([['api.tavily.com', { body: { answer: '', results: [{ title: 'T', url: 'https://t.test/1', content: 'body' }] } }]]),
    )
    const secrets = {}
    const { ctx, tools, store, pending } = lateCtx(secrets)
    apply(ctx, { instances: JSON.stringify([{ id: 'tv', type: 'tavily', name: 'Tavily', enabled: true }]) })

    // Before the store exists: a keyed source with no key is not offered.
    const before = await tools.get('federated_web_search').execute({}, { signal: undefined })
    assert.doesNotMatch(before.text, /`tavily`/)

    // The store mounts, and the settings card saves a key afterwards.
    for (const { names, callback } of pending) {
      if (!names.includes('credentials')) continue
      callback({
        credentials: store,
        connection: { requestRejection: () => undefined },
        webServer: { register: () => {} },
        configEditor: { entries: () => [] },
        effect: (fn) => fn(),
      })
    }
    await store.set('INFO_TV', 'tvly-test')

    // The very next call must already see it.
    const after = await tools.get('federated_web_search').execute({}, { signal: undefined })
    assert.match(after.text, /`tavily` — Tavily（网页搜索）/)
    const value = await tools.get('federated_web_search').execute({ query: 'q', sources: ['tv'] }, { signal: undefined })
    assert.equal(value.sources.length, 1)
    assert.equal(value.sources[0].url, 'https://t.test/1')
    __setFetchForTest(null)
  })
})
