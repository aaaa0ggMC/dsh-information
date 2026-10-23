/**
 * Unit tests for the pure logic: the DI registry, the cross-source merge, the
 * config contract, the formatters and two representative sources (one keyed
 * vendor with a nested response, one keyless fact source).
 *
 * Every network call goes through the injectable fetch seam, so this suite
 * never touches the network.
 *
 * @module dsh-information/test
 */

import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'

import { SourceRegistry } from '../src/registry.js'
import { mergeOutputs, normalizeUrl, parseSourceList } from '../src/merge.js'
import { formatCatalog, formatFactResult, formatWebResult } from '../src/format.js'
import { DEFAULTS, ON_ERROR_NEXT, ON_ERROR_STOP, parseDisabledTypes, parseInstances, resolveConfig } from '../config.js'
import { WEB_SOURCES } from '../src/sources/web.js'
import { FACT_SOURCES } from '../src/sources/fact.js'
import { __setFetchForTest } from '../src/http.js'

const ALL_TYPES = [...WEB_SOURCES, ...FACT_SOURCES]
const knownType = (id) => ALL_TYPES.some((type) => type.id === id)

/** A fake fetch that answers by URL substring, recording every call. */
function fakeFetch(routes) {
  /** @type {{ url: string, init?: RequestInit }[]} */
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init })
    for (const [match, response] of routes) {
      if (String(url).includes(match)) {
        if (response.throw !== undefined) throw response.throw
        return {
          ok: response.status === undefined || (response.status >= 200 && response.status < 300),
          status: response.status ?? 200,
          headers: { get: () => null },
          json: async () => response.body,
          text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body)),
        }
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => 'not found' }
  }
  return { impl, calls }
}

before(() => {
  __setFetchForTest(null)
})

describe('registry', () => {
  it('registers, lists and disposes sources', () => {
    const registry = new SourceRegistry()
    const dispose = registry.register({ id: 'demo', label: 'Demo', kind: 'web', hint: '', keyless: true, search: async () => ({ hits: [] }) })
    assert.equal(registry.has('demo'), true)
    assert.equal(registry.list().length, 1)
    dispose()
    assert.equal(registry.has('demo'), false)
  })

  it('rejects a duplicate id and a malformed source', () => {
    const registry = new SourceRegistry()
    const source = { id: 'demo', label: 'Demo', kind: 'web', hint: '', keyless: true, search: async () => ({ hits: [] }) }
    registry.register(source)
    assert.throws(() => registry.register(source), /already registered/)
    assert.throws(() => registry.register({ ...source, id: 'Bad Id' }), /source id must match/)
    assert.throws(() => registry.register({ ...source, kind: 'other' }), /unknown kind/)
  })

  it('ships every documented type exactly once', () => {
    const registry = new SourceRegistry()
    for (const type of ALL_TYPES) registry.register(type)
    assert.equal(registry.byKind('web').length, 9)
    assert.equal(registry.byKind('fact').length, 8)
    assert.equal(new Set(registry.ids()).size, registry.ids().length)
  })
})

describe('merge', () => {
  it('normalizes URLs before comparing them', () => {
    assert.equal(
      normalizeUrl('https://Example.com/a/b/?utm_source=x&utm_medium=y#frag'),
      'https://example.com/a/b',
    )
    assert.equal(normalizeUrl('not a url'), 'not a url')
  })

  it('ranks a URL returned by several sources first', () => {
    const merged = mergeOutputs(
      {
        outputs: [
          { id: 'a', output: { hits: [{ title: 'A1', url: 'https://x.test/1', snippet: 'first' }, { title: 'A2', url: 'https://x.test/2?utm_source=q', snippet: 'second' }] } },
          { id: 'b', output: { hits: [{ title: 'B1', url: 'https://x.test/2', snippet: 'second from b' }, { title: 'B3', url: 'https://x.test/3', snippet: 'third' }] } },
        ],
        reports: [],
      },
      { maxResults: 5 },
    )
    assert.deepEqual(merged.hits.map((hit) => hit.url), ['https://x.test/2', 'https://x.test/1', 'https://x.test/3'])
    assert.deepEqual(merged.hits[0].engines, ['a', 'b'])
    // The copy from the source that ranked it highest wins (B ranked it first).
    assert.equal(merged.hits[0].snippet, 'second from b')
  })

  it('honours maxResults and keeps the first answer', () => {
    const merged = mergeOutputs(
      {
        outputs: [
          { id: 'a', output: { answer: '', hits: [{ title: '1', url: 'https://x.test/1', snippet: '' }, { title: '2', url: 'https://x.test/2', snippet: '' }] } },
          { id: 'b', output: { answer: 'the answer', citations: [{ title: 'src', url: 'https://x.test/src' }], hits: [] } },
        ],
        reports: [],
      },
      { maxResults: 1 },
    )
    assert.equal(merged.hits.length, 1)
    assert.equal(merged.answer, 'the answer')
    assert.deepEqual(merged.citations, [{ title: 'src', url: 'https://x.test/src' }])
  })

  it('parses a source list, keeping order and reporting unknowns', () => {
    const { wanted, unknown } = parseSourceList(' Bocha , tavily ,bocha, nope ', knownType)
    assert.deepEqual(wanted, ['bocha', 'tavily'])
    assert.deepEqual(unknown, ['nope'])
  })
})

describe('config', () => {
  it('resolves defaults', () => {
    const config = resolveConfig(undefined, knownType)
    assert.equal(config.maxResults, DEFAULTS.maxResults)
    assert.deepEqual(JSON.parse(config.disabledTypes), [])
    assert.equal(parseInstances(config.instances, knownType).length, 6)
  })

  it('rejects an unknown key and a bad integer', () => {
    assert.throws(() => resolveConfig({ nope: 1 }, knownType), /unknown config key/)
    assert.throws(() => resolveConfig({ maxResults: 0 }, knownType), /`maxResults` must be an integer/)
  })

  it('keeps only known type ids in disabledTypes', () => {
    assert.deepEqual(parseDisabledTypes('["tavily","nope","bocha"]', knownType), ['tavily', 'bocha'])
    assert.deepEqual(parseDisabledTypes('not json', knownType), [])
  })

  it('drops malformed instances and de-duplicates ids', () => {
    const instances = parseInstances(
      JSON.stringify([
        { id: 'wikipedia', type: 'wikipedia', name: '维基' },
        { id: 'wikipedia', type: 'wikipedia', name: '重复' },
        { id: 'ghost', type: 'does-not-exist' },
        { id: 'bad id!', type: 'wikipedia' },
        { id: 'arxiv', type: 'arxiv', onError: 'stop' },
      ]),
      knownType,
    )
    assert.deepEqual(instances.map((instance) => instance.id), ['wikipedia', 'arxiv'])
    assert.equal(instances[0].onError, ON_ERROR_NEXT)
    assert.equal(instances[1].onError, ON_ERROR_STOP)
  })

  it('respects an explicitly empty list', () => {
    assert.deepEqual(parseInstances('[]', knownType), [])
  })
})

describe('format', () => {
  it('renders a web result with answer, hits, failures and the notice', () => {
    const text = formatWebResult({
      query: 'dsh plugin',
      answer: 'an answer',
      citations: [{ title: '', url: 'https://x.test' }],
      hits: [{ title: 'Hit', url: 'https://x.test/1', snippet: 'body', engines: ['tavily', 'bocha'] }],
      failed: [{ label: 'Brave', error: 'HTTP 429' }],
    })
    assert.match(text, /an answer/)
    assert.match(text, /\[1\] Hit — https:\/\/x\.test\/1/)
    assert.match(text, /来源：tavily, bocha/)
    assert.match(text, /「Brave」没有返回结果：HTTP 429/)
    assert.match(text, /untrusted information/)
  })

  it('renders fact sections per source', () => {
    const text = formatFactResult({
      query: 'lambda',
      sections: [
        { label: 'Wikipedia 概要', hits: [{ title: 'Lambda calculus', url: 'https://en.wikipedia.org/?curid=1', snippet: 'a formalism' }] },
        { label: 'OpenAlex 学术', hits: [], error: 'timeout' },
      ],
    })
    assert.match(text, /### Wikipedia 概要/)
    assert.match(text, /\*\*Lambda calculus\*\* — a formalism/)
    assert.match(text, /### OpenAlex 学术\n- 取数失败：timeout/)
  })

  it('lists the catalog for an unknown source error', () => {
    const text = formatCatalog([{ id: 'wikipedia', label: 'Wikipedia 概要', kind: 'fact', hint: '条目摘要' }])
    assert.match(text, /`wikipedia` — Wikipedia 概要（事实查询）：条目摘要/)
  })
})

describe('sources', () => {
  it('tavily maps answer + hits and sends the bearer key', async () => {
    const { impl, calls } = fakeFetch([
      ['api.tavily.com/search', { body: { answer: 'yes', results: [{ title: 'T', url: 'https://t.test', content: 'body  text' }] } }],
    ])
    __setFetchForTest(impl)
    const out = await WEB_SOURCES.find((type) => type.id === 'tavily').search('q', { maxResults: 3, key: 'k', extra: {} })
    assert.equal(out.answer, 'yes')
    assert.equal(out.hits[0].url, 'https://t.test')
    assert.equal(out.hits[0].snippet, 'body text')
    assert.equal(calls[0].init.headers.authorization, 'Bearer k')
    assert.equal(JSON.parse(calls[0].init.body).max_results, 3)
    __setFetchForTest(null)
  })

  it('bocha reads the Bing-compatible webPages.value array', async () => {
    const { impl } = fakeFetch([
      [
        'api.bochaai.com',
        {
          body: {
            code: 200,
            data: { webPages: { value: [{ name: 'B', url: 'https://b.test', snippet: 'sn', summary: 'more', datePublished: '2026-01-01' }] } },
          },
        },
      ],
    ])
    __setFetchForTest(impl)
    const out = await WEB_SOURCES.find((type) => type.id === 'bocha').search('q', { maxResults: 3, key: 'k', extra: {} })
    assert.equal(out.hits.length, 1)
    assert.equal(out.hits[0].snippet, 'sn more')
    assert.equal(out.hits[0].publishedAt, '2026-01-01')
    __setFetchForTest(null)
  })

  it('bigmodel maps search_result and pins the engine', async () => {
    const { impl, calls } = fakeFetch([
      ['open.bigmodel.cn', { body: { search_result: [{ title: 'Z', link: 'https://z.test', content: 'body', publish_date: '2026-02-02' }] } }],
    ])
    __setFetchForTest(impl)
    const out = await WEB_SOURCES.find((type) => type.id === 'bigmodel').search('q', { maxResults: 3, key: 'k', extra: { engine: 'search_pro_sogou' } })
    const body = JSON.parse(calls[0].init.body)
    assert.equal(body.search_engine, 'search_pro_sogou')
    assert.equal(body.search_intent, false)
    assert.equal(out.hits[0].title, 'Z')
    assert.equal(out.hits[0].publishedAt, '2026-02-02')
    __setFetchForTest(null)
  })

  it('wikipedia sorts pages by index and keeps only non-empty extracts', async () => {
    const { impl } = fakeFetch([
      [
        'en.wikipedia.org',
        {
          body: {
            query: {
              pages: {
                '7': { title: 'Second', index: 2, pageid: 7, extract: 'second body' },
                '3': { title: 'First', index: 1, pageid: 3, extract: 'first body' },
                '9': { title: 'Empty', index: 3, pageid: 9, extract: '' },
              },
            },
          },
        },
      ],
    ])
    __setFetchForTest(impl)
    const out = await FACT_SOURCES.find((type) => type.id === 'wikipedia').search('lambda', { maxResults: 5, extra: {} })
    assert.deepEqual(out.hits.map((hit) => hit.title), ['First', 'Second'])
    assert.equal(out.hits[0].url, 'https://en.wikipedia.org/?curid=3')
    __setFetchForTest(null)
  })

  it('surfaces an HTTP error with status and body excerpt', async () => {
    const { impl } = fakeFetch([['api.tavily.com', { status: 401, body: 'invalid api key' }]])
    __setFetchForTest(impl)
    await assert.rejects(
      WEB_SOURCES.find((type) => type.id === 'tavily').search('q', { maxResults: 3, key: 'bad', extra: {} }),
      /tavily: HTTP 401 — invalid api key/,
    )
    __setFetchForTest(null)
  })

  it('google refuses to run without the cx parameter', async () => {
    await assert.rejects(
      WEB_SOURCES.find((type) => type.id === 'google').search('q', { maxResults: 3, key: 'k', extra: {} }),
      /google: missing "cx"/,
    )
  })
})
