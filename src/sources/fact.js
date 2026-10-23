/**
 * Fact / structured-data source types.
 *
 * These are the "second half" of an information plugin: not "find me pages
 * about X" but "give me the structured record for X" — an encyclopedia
 * extract, a DOI, a paper, a repository. All of them are keyless public APIs,
 * which is why they ship enabled by default and cost nothing to run.
 *
 * Ported from the Launcher/YAYA `info-sources.ts` type registry, same
 * contracts, so behaviour that was already exercised in production carries over.
 *
 * @module dsh-information/sources/fact
 */

import { clip, getJson, getText, list, str } from '../http.js'

/** Strip HTML and collapse whitespace; wiki extracts arrive with markup. */
function strip(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First capture group of a regex, or `''` — coarse Atom/XML parsing. */
function field(text, re) {
  return re.exec(text)?.[1] ?? ''
}

/**
 * Wikipedia — https://www.mediawiki.org/wiki/API:Search
 * GET https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search
 *     &gsrsearch={q}&gsrlimit=3&gsrnamespace=0&prop=extracts&exintro=1&explaintext=1
 * response: { query?: { pages?: { "<pageid>": { title, extract, index } } } }.
 */
export const wikipedia = {
  id: 'wikipedia',
  label: 'Wikipedia 概要',
  kind: 'fact',
  hint: '条目搜索 + 开头摘要（英文维基，免 key），适合概念/背景类问题',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('generator', 'search')
    url.searchParams.set('gsrsearch', query)
    url.searchParams.set('gsrlimit', String(Math.min(5, options.maxResults)))
    url.searchParams.set('gsrnamespace', '0')
    url.searchParams.set('prop', 'extracts')
    url.searchParams.set('exintro', '1')
    url.searchParams.set('explaintext', '1')
    const data = await getJson(url.toString(), { signal: options.signal, source: 'wikipedia' })
    const pages = (data.query ?? {}).pages ?? {}
    const hits = Object.values(pages)
      .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
      .map((page) => {
        const title = str(page?.title)
        const pageId = str(page?.pageid)
        const extract = clip(strip(str(page?.extract)), 500)
        if (!title || !extract) return null
        return {
          title,
          url: pageId ? `https://en.wikipedia.org/?curid=${pageId}` : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
          snippet: extract,
        }
      })
      .filter((hit) => hit !== null)
    return { hits }
  },
}

/**
 * Wiktionary — https://en.wiktionary.org/api/rest_v1/page/definition/{term}
 * GET, no key. response: { "<lang>": [{ definition, partOfSpeech, examples? }] }.
 */
export const wiktionary = {
  id: 'wiktionary',
  label: 'Wiktionary 释义',
  kind: 'fact',
  hint: '单词/词组的词性与释义（英文，免 key），按语言分组',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(query)}`, {
      signal: options.signal,
      source: 'wiktionary',
    })
    /** @type {{ title: string, url: string, snippet: string }[]} */
    const hits = []
    for (const [language, definitions] of Object.entries(data)) {
      for (const entry of list(definitions).slice(0, 2)) {
        const meaning = strip(str(entry?.definition))
        if (!meaning) continue
        hits.push({
          title: `${query} · ${language} · ${str(entry?.partOfSpeech) || '释义'}`,
          url: `https://en.wiktionary.org/wiki/${encodeURIComponent(query)}`,
          snippet: clip(meaning, 300),
        })
      }
      if (hits.length >= Math.min(5, options.maxResults)) break
    }
    return { hits }
  },
}

/**
 * OpenAlex — https://docs.openalex.org/api-entities/works
 * GET https://api.openalex.org/works?search={q}&per-page=5. No key, 10 req/s.
 * response: { results?: [{ display_name, publication_year, cited_by_count, doi, primary_location }] }.
 */
export const openalex = {
  id: 'openalex',
  label: 'OpenAlex 学术',
  kind: 'fact',
  hint: '2.5 亿+ 学术作品（题名/年份/被引/DOI），免 key、10 req/s',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://api.openalex.org/works')
    url.searchParams.set('search', query)
    url.searchParams.set('per-page', String(Math.min(10, options.maxResults)))
    const data = await getJson(url.toString(), { signal: options.signal, source: 'openalex' })
    const hits = list(data.results)
      .map((item) => {
        const row = item ?? {}
        const title = str(row.display_name)
        if (!title) return null
        const bits = [str(row.publication_year)]
        const cited = Number(row.cited_by_count)
        if (Number.isFinite(cited)) bits.push(`被引 ${cited}`)
        const doi = str(row.doi)
        if (doi) bits.push(doi)
        const landing = (row.primary_location ?? {}).landing_page_url
        return {
          title,
          url: str(doi) || str(landing),
          snippet: clip(bits.filter(Boolean).join(' · '), 300),
        }
      })
      .filter((hit) => hit !== null)
    return { hits }
  },
}

/**
 * Crossref — https://api.crossref.org/works?query={q}&rows=5. No key, 50 req/s.
 * response: { message?: { items?: [{ title, container-title, issued, DOI, URL }] } }.
 */
export const crossref = {
  id: 'crossref',
  label: 'Crossref DOI',
  kind: 'fact',
  hint: '1.3 亿+ 学术作品的 DOI 元数据，免 key、50 req/s',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://api.crossref.org/works')
    url.searchParams.set('query', query)
    url.searchParams.set('rows', String(Math.min(10, options.maxResults)))
    const data = await getJson(url.toString(), { signal: options.signal, source: 'crossref' })
    const hits = list((data.message ?? {}).items)
      .map((item) => {
        const row = item ?? {}
        const title = clip(str(row.title), 300)
        if (!title) return null
        const year = (row.issued ?? {})['date-parts']?.[0]?.[0]
        const bits = [str(row['container-title']), year ? String(year) : '', str(row.DOI)].filter(Boolean)
        return { title, url: str(row.URL), snippet: clip(bits.join(' · '), 300) }
      })
      .filter((hit) => hit !== null)
    return { hits }
  },
}

/**
 * arXiv — http://export.arxiv.org/api/query?search_query=all:{q}&max_results=5
 * Atom XML (not JSON), 3 req/s. Entries carry title/summary/id/published.
 */
export const arxiv = {
  id: 'arxiv',
  label: 'arXiv 预印本',
  kind: 'fact',
  hint: 'arXiv 论文（Atom XML，3 req/s），适合理工科最新研究',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}&max_results=${Math.min(10, options.maxResults)}&sortBy=relevance`
    const xml = await getText(url, { signal: options.signal, source: 'arxiv' })
    const hits = []
    for (const entry of (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []).slice(0, options.maxResults)) {
      const title = clip(strip(field(entry, /<title>([\s\S]*?)<\/title>/)), 300)
      const summary = clip(strip(field(entry, /<summary>([\s\S]*?)<\/summary>/)), 300)
      const id = field(entry, /<id>([\s\S]*?)<\/id>/).trim()
      const published = field(entry, /<published>([\s\S]*?)<\/published>/).trim().slice(0, 10)
      if (!title) continue
      hits.push({
        title,
        url: id,
        snippet: [published, summary].filter(Boolean).join(' · '),
        ...(published ? { publishedAt: published } : {}),
      })
    }
    return { hits }
  },
}

/**
 * Hacker News (Algolia) — https://hn.algolia.com/api/v1/search?query={q}&hitsPerPage=5
 * No key, 10k requests/hour. Hits carry points/created_at/url/objectID.
 */
export const hackernews = {
  id: 'hackernews',
  label: 'Hacker News',
  kind: 'fact',
  hint: 'HN 文章与讨论（Algolia，1 万次/小时），技术与创业风向',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://hn.algolia.com/api/v1/search')
    url.searchParams.set('query', query)
    url.searchParams.set('hitsPerPage', String(Math.min(10, options.maxResults)))
    const data = await getJson(url.toString(), { signal: options.signal, source: 'hackernews' })
    const hits = list(data.hits)
      .map((item) => {
        const row = item ?? {}
        const title = str(row.title) || str(row.story_title)
        if (!title) return null
        const bits = [`▲${str(row.points) || 0}`, str(row.created_at).slice(0, 10)].filter(Boolean)
        const link = str(row.url)
        return {
          title,
          url: link || `https://news.ycombinator.com/item?id=${str(row.objectID)}`,
          snippet: clip(bits.join(' · '), 300),
        }
      })
      .filter((hit) => hit !== null)
    return { hits }
  },
}

/**
 * GitHub repository search — https://docs.github.com/rest/search/search#search-repositories
 * GET https://api.github.com/search/repositories?q={q}&per_page=5. No key for
 * low volumes (60 requests/hour per IP); set `GITHUB_TOKEN` in the environment
 * to raise it — the env fallback is read by the credential resolver.
 */
export const github = {
  id: 'github',
  label: 'GitHub 仓库',
  kind: 'fact',
  hint: '按名字/描述搜仓库（免 key，60 次/小时；有 GITHUB_TOKEN 会更高）',
  keyless: true,
  credentialRef: 'GITHUB_TOKEN',
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', query)
    url.searchParams.set('per_page', String(Math.min(10, options.maxResults)))
    const headers = {}
    if (options.key) headers.authorization = `Bearer ${options.key}`
    const data = await getJson(url.toString(), {
      headers,
      signal: options.signal,
      source: 'github',
    })
    const hits = list(data.items)
      .map((item) => {
        const row = item ?? {}
        const title = str(row.full_name)
        if (!title) return null
        const bits = [`★${str(row.stargazers_count) || 0}`, str(row.language)]
        const description = clip(str(row.description), 160)
        if (description) bits.push(description)
        return { title, url: str(row.html_url), snippet: clip(bits.filter(Boolean).join(' · '), 300) }
      })
      .filter((hit) => hit !== null)
    return { hits }
  },
}

/**
 * DuckDuckGo Instant Answer — https://api.duckduckgo.com/?q={q}&format=json
 * No key. Not a web search: it answers definitions/summaries and related
 * topics, which makes it a good cheap first hop for "what is X".
 */
export const duckduckgo = {
  id: 'duckduckgo',
  label: 'DuckDuckGo 即时回答',
  kind: 'fact',
  hint: '摘要/定义/相关主题（免 key，不是网页搜索）',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('skip_disambig', '1')
    const data = await getJson(url.toString(), { signal: options.signal, source: 'duckduckgo' })
    const head = [str(data.Answer), str(data.AbstractText), str(data.Definition)].filter(Boolean).join('\n')
    /** @type {{ title: string, url: string, snippet: string }[]} */
    const hits = []
    const heading = str(data.Heading) || str(data.AbstractSource)
    if (head) hits.push({ title: heading || '即时回答', url: str(data.AbstractURL), snippet: clip(head, 500) })
    if (hits.length < Math.min(5, options.maxResults)) {
      for (const topic of list(data.RelatedTopics).slice(0, 3)) {
        const text = strip(str(topic?.Text) || str(topic?.Result))
        if (!text) continue
        hits.push({ title: text.split(' - ')[0] ?? text, url: '', snippet: clip(text, 220) })
      }
    }
    return { hits }
  },
}

/** @type {readonly import('../registry.js').InformationSource[]} */
export const FACT_SOURCES = Object.freeze([
  wikipedia,
  wiktionary,
  openalex,
  crossref,
  arxiv,
  hackernews,
  github,
  duckduckgo,
])
