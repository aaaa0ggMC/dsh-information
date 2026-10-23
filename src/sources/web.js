/**
 * Web search source types.
 *
 * Every entry is one vendor, implemented against its official REST contract
 * (the URL, the auth header and the parameter names are spelled out in the
 * comment above each source, so a future API change has one place to land).
 * Adding a vendor = appending one object here; the registry, the merge, the
 * tools, the settings card and the tests all pick it up unchanged.
 *
 * @module dsh-information/sources/web
 */

import { clip, getJson, getText, list, postJson, str } from '../http.js'
import { tavilyUsage } from '../usage.js'

/**
 * Tavily — https://docs.tavily.com/documentation/api-reference/search
 * POST https://api.tavily.com/search, `Authorization: Bearer <key>`.
 * body: query / max_results(1..10) / topic('general'|'news') /
 *       search_depth('basic'|'advanced') / include_answer.
 * response: { answer?, results?: [{ title, url, content }] }.
 */
export const tavily = {
  id: 'tavily',
  label: 'Tavily',
  kind: 'web',
  hint: '带回答与引用的通用网页搜索，英文覆盖好；key 在 tavily.com 申请',
  keyless: false,
  credentialRef: 'TAVILY_API_KEY',
  defaults: { topic: 'general', depth: 'basic' },
  /**
   * Tavily publishes a quota endpoint (ten probes per key per ten minutes), so
   * the settings card can show remaining credits. See `src/usage.js` for the
   * caching and back-off discipline that keeps the card from burning it.
   */
  usage: (options) => tavilyUsage(options),
  search: async (query, options) => {
    const data = await postJson(
      'https://api.tavily.com/search',
      {
        query,
        max_results: options.maxResults,
        topic: str(options.extra?.topic) || 'general',
        search_depth: str(options.extra?.depth) === 'advanced' ? 'advanced' : 'basic',
        include_answer: true,
      },
      { headers: { authorization: `Bearer ${options.key ?? ''}` }, signal: options.signal, source: 'tavily' },
    )
    return {
      answer: str(data.answer) || null,
      hits: list(data.results).map((item) => {
        const row = item ?? {}
        return { title: str(row.title), url: str(row.url), snippet: clip(str(row.content)) }
      }),
    }
  },
}

/**
 * 博查 Bocha — https://bochaai.com （开放平台 open.bochaai.com）
 * POST https://api.bochaai.com/v1/web-search, `Authorization: Bearer <key>`.
 * body: query / freshness('oneDay'|'oneWeek'|'oneMonth'|'oneYear'|'noLimit') /
 *       summary(bool) / count.
 * response is Bing-compatible: { code, data: { webPages: { value?: [{ name,
 * url, snippet, summary, siteName, datePublished }] } } } — some deployments
 * nest the array under `webPages.webPages` instead, so both are read.
 */
export const bocha = {
  id: 'bocha',
  label: '博查',
  kind: 'web',
  hint: '国内网页搜索 API，中文结果稳定、响应兼容 Bing；key 在 open.bochaai.com 申请',
  keyless: false,
  credentialRef: 'BOCHA_API_KEY',
  defaults: { freshness: 'noLimit', summary: true },
  search: async (query, options) => {
    const data = await postJson(
      'https://api.bochaai.com/v1/web-search',
      {
        query,
        count: options.maxResults,
        freshness: str(options.extra?.freshness) || 'noLimit',
        summary: options.extra?.summary !== false,
      },
      { headers: { authorization: `Bearer ${options.key ?? ''}` }, signal: options.signal, source: 'bocha' },
    )
    const webPages = (data.data ?? {}).webPages ?? {}
    const rows = list(webPages.value).length > 0 ? list(webPages.value) : list(webPages.webPages)
    return {
      answer: null,
      hits: rows.map((item) => {
        const row = item ?? {}
        const snippet = [str(row.snippet), str(row.summary)].filter(Boolean).join(' ')
        return {
          title: str(row.name),
          url: str(row.url),
          snippet: clip(snippet),
          ...(str(row.datePublished) ? { publishedAt: str(row.datePublished) } : {}),
        }
      }),
    }
  },
}

/**
 * 智谱 BigModel Web Search API — https://docs.bigmodel.cn/cn/guide/tools/web-search
 * POST https://open.bigmodel.cn/api/paas/v4/web_search, `Authorization: Bearer <key>`.
 * body: search_query / search_engine('search_std'|'search_pro'|'search_pro_sogou'|
 *       'search_pro_quark') / search_intent(bool) / count(1..50) /
 *       search_domain_filter? / search_recency_filter? / content_size?.
 * response: { search_result?: [{ title, content, link, media, publish_date }] }.
 */
export const bigmodel = {
  id: 'bigmodel',
  label: '智谱 BigModel',
  kind: 'web',
  hint: '智谱联网搜索，中文/垂直内容强，可按引擎（搜狗/夸克）与时间范围过滤',
  keyless: false,
  credentialRef: 'BIGMODEL_API_KEY',
  defaults: { engine: 'search_std', recency: 'noLimit', contentSize: 'medium' },
  search: async (query, options) => {
    const data = await postJson(
      'https://open.bigmodel.cn/api/paas/v4/web_search',
      {
        search_query: query,
        search_engine: str(options.extra?.engine) || 'search_std',
        search_intent: false,
        count: options.maxResults,
        search_recency_filter: str(options.extra?.recency) || 'noLimit',
        content_size: str(options.extra?.contentSize) || 'medium',
      },
      { headers: { authorization: `Bearer ${options.key ?? ''}` }, signal: options.signal, source: 'bigmodel' },
    )
    return {
      answer: null,
      hits: list(data.search_result).map((item) => {
        const row = item ?? {}
        return {
          title: str(row.title),
          url: str(row.link),
          snippet: clip(str(row.content)),
          ...(str(row.publish_date) ? { publishedAt: str(row.publish_date) } : {}),
        }
      }),
    }
  },
}

/**
 * Brave Search — https://api-docs.search.brave.com/
 * GET https://api.search.brave.com/res/v1/web/search, `X-Subscription-Token` header.
 * params: q / count(1..20) / country / search_lang.
 * response: { web?: { results?: [{ title, url, description }] } }.
 */
export const brave = {
  id: 'brave',
  label: 'Brave',
  kind: 'web',
  hint: '独立索引的通用网页搜索，英文技术内容覆盖好',
  keyless: false,
  credentialRef: 'BRAVE_API_KEY',
  defaults: {},
  search: async (query, options) => {
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(options.maxResults))
    if (str(options.extra?.country)) url.searchParams.set('country', str(options.extra.country))
    if (str(options.extra?.searchLang)) url.searchParams.set('search_lang', str(options.extra.searchLang))
    const data = await getJson(url.toString(), {
      headers: { 'x-subscription-token': options.key ?? '' },
      signal: options.signal,
      source: 'brave',
    })
    const web = (data.web ?? {}).results ?? []
    return {
      answer: null,
      hits: list(web).map((item) => {
        const row = item ?? {}
        return { title: str(row.title), url: str(row.url), snippet: clip(str(row.description)) }
      }),
    }
  },
}

/**
 * Bing Web Search v7 — https://learn.microsoft.com/en-us/bing/search-apis/
 * GET https://api.bing.microsoft.com/v7.0/search, `Ocp-Apim-Subscription-Key` header.
 * params: q / count(1..50) / mkt / responseFilter=Webpages.
 * response: { webPages?: { value?: [{ name, url, snippet, datePublished }] } }.
 */
export const bing = {
  id: 'bing',
  label: 'Bing',
  kind: 'web',
  hint: 'Bing 网页搜索 v7，mkt 可指定市场（zh-CN / en-US）',
  keyless: false,
  credentialRef: 'BING_API_KEY',
  defaults: { mkt: 'en-US' },
  search: async (query, options) => {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(options.maxResults))
    url.searchParams.set('responseFilter', 'Webpages')
    url.searchParams.set('mkt', str(options.extra?.mkt) || 'en-US')
    const data = await getJson(url.toString(), {
      headers: { 'ocp-apim-subscription-key': options.key ?? '' },
      signal: options.signal,
      source: 'bing',
    })
    const value = (data.webPages ?? {}).value ?? []
    return {
      answer: null,
      hits: list(value).map((item) => {
        const row = item ?? {}
        return {
          title: str(row.name),
          url: str(row.url),
          snippet: clip(str(row.snippet)),
          ...(str(row.datePublished) ? { publishedAt: str(row.datePublished) } : {}),
        }
      }),
    }
  },
}

/**
 * Google Custom Search JSON API —
 * https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
 * GET https://www.googleapis.com/customsearch/v1?key=…&cx=…&q=…&num=1..10.
 * `cx` (the programmable search engine id) is a required per-instance extra.
 */
export const google = {
  id: 'google',
  label: 'Google',
  kind: 'web',
  hint: 'Google 可编程搜索引擎，需要 key + cx 两个值；结果最干净',
  keyless: false,
  credentialRef: 'GOOGLE_API_KEY',
  defaults: {},
  search: async (query, options) => {
    const cx = str(options.extra?.cx)
    if (!cx) throw new Error('google: missing "cx" (search engine id) in the instance parameters')
    const url = new URL('https://www.googleapis.com/customsearch/v1')
    url.searchParams.set('key', options.key ?? '')
    url.searchParams.set('cx', cx)
    url.searchParams.set('q', query)
    url.searchParams.set('num', String(Math.min(10, options.maxResults)))
    const data = await getJson(url.toString(), { signal: options.signal, source: 'google' })
    return {
      answer: null,
      hits: list(data.items).map((item) => {
        const row = item ?? {}
        return { title: str(row.title), url: str(row.link), snippet: clip(str(row.snippet)) }
      }),
    }
  },
}

/**
 * SearXNG — https://docs.searxng.org/dev/search_api.html
 * GET <baseUrl>/search?format=json&q=…&pageno=1. No credential: the instance
 * carries the base URL. An instance with JSON output disabled answers with
 * HTML, which surfaces as "invalid JSON response".
 */
export const searxng = {
  id: 'searxng',
  label: 'SearXNG',
  kind: 'web',
  hint: '自建 / 公共 SearXNG 实例，免 key；聚合多家搜索引擎结果',
  keyless: true,
  defaults: {},
  search: async (query, options) => {
    const base = str(options.baseUrl).replace(/\/+$/, '')
    if (!base) throw new Error('searxng: the instance has no baseUrl')
    const url = new URL(/\/search$/i.test(base) ? base : `${base}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('pageno', '1')
    if (str(options.extra?.language)) url.searchParams.set('language', str(options.extra.language))
    if (str(options.extra?.safesearch)) url.searchParams.set('safesearch', str(options.extra.safesearch))
    const data = await getJson(url.toString(), { signal: options.signal, source: 'searxng' })
    return {
      answer: null,
      hits: list(data.results).map((item) => {
        const row = item ?? {}
        return {
          title: str(row.title),
          url: str(row.url),
          snippet: clip(str(row.content)),
          ...(str(row.published_date) ? { publishedAt: str(row.published_date) } : {}),
        }
      }),
    }
  },
}

/**
 * Grok (xAI) — https://docs.x.ai/developers/tools/web-search
 * POST https://api.x.ai/v1/responses (Responses API), `Authorization: Bearer <key>`.
 * body: { model, input, tools: [{ type: 'web_search' }], include: ['no_inline_citations'] }
 * — the include flag keeps inline `[[n]](url)` markers out of the answer so the
 * citation list stays the single source of truth.
 * response: output[] items of type 'message' carry output_text; citations is a
 * top-level string[]. There is no result list: the answer *is* the result.
 */
export const grok = {
  id: 'grok',
  label: 'Grok (xAI)',
  kind: 'web',
  hint: 'xAI 回答型搜索：先检索再生成答案并附引用，适合开放式问题',
  keyless: false,
  credentialRef: 'XAI_API_KEY',
  defaults: { model: 'grok-4-fast' },
  search: async (query, options) => {
    const data = await postJson(
      'https://api.x.ai/v1/responses',
      {
        model: str(options.extra?.model) || 'grok-4-fast',
        input: [{ role: 'user', content: query }],
        tools: [{ type: 'web_search' }],
        include: ['no_inline_citations'],
      },
      { headers: { authorization: `Bearer ${options.key ?? ''}` }, signal: options.signal, source: 'grok' },
    )
    const answer = list(data.output)
      .map((item) => {
        const row = item ?? {}
        if (str(row.type) !== 'message') return ''
        return list(row.content)
          .map((block) => (str((block ?? {}).type) === 'output_text' ? str(block.text) : ''))
          .filter(Boolean)
          .join('\n')
      })
      .filter(Boolean)
      .join('\n\n')
    return {
      answer: answer || null,
      citations: list(data.citations)
        .map((url) => ({ title: '', url: str(url) }))
        .filter((citation) => citation.url),
      hits: [],
    }
  },
}

/**
 * Exa — https://docs.exa.ai/reference/search
 * POST https://api.exa.ai/search, `x-api-key` header.
 * body: query / numResults / contents.text (snippet extraction).
 * response: { results?: [{ title, url, text, publishedDate }] }.
 */
export const exa = {
  id: 'exa',
  label: 'Exa',
  kind: 'web',
  hint: '为 AI 设计的神经搜索，按语义而非关键词匹配，英文技术/论文覆盖好',
  keyless: false,
  credentialRef: 'EXA_API_KEY',
  defaults: {},
  search: async (query, options) => {
    const data = await postJson(
      'https://api.exa.ai/search',
      { query, numResults: options.maxResults, contents: { text: { maxCharacters: 600 } } },
      { headers: { 'x-api-key': options.key ?? '' }, signal: options.signal, source: 'exa' },
    )
    return {
      answer: null,
      hits: list(data.results).map((item) => {
        const row = item ?? {}
        return {
          title: str(row.title),
          url: str(row.url),
          snippet: clip(str(row.text)),
          ...(str(row.publishedDate) ? { publishedAt: str(row.publishedDate) } : {}),
        }
      }),
    }
  },
}

/** @type {readonly import('../registry.js').InformationSource[]} */
export const WEB_SOURCES = Object.freeze([tavily, bocha, bigmodel, brave, bing, google, searxng, grok, exa])
