// 联网搜索：默认内置免费源（DuckDuckGo → Bing 兜底），可选博查 / Tavily API 增强
import { getConfig } from './config'
import { Provider } from './config'

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const TIMEOUT = 15000

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/** 免费源 1：DuckDuckGo HTML 版 */
async function searchDuck(query: string): Promise<WebSearchHit[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`)
  const html = await res.text()
  const hits: WebSearchHit[] = []
  // 结果块：<a rel="nofollow" class="result__a" href="真实URL（可能带 uddg= 重定向）">标题</a> ... class="result__snippet"
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && hits.length < 10) {
    let url = m[1]
    const uddg = /[?&]uddg=([^&]+)/.exec(url)
    if (uddg) url = decodeURIComponent(uddg[1])
    const title = stripTags(m[2])
    const snippet = stripTags(m[3])
    if (title && url.startsWith('http')) hits.push({ title, url, snippet })
  }
  if (!hits.length) throw new Error('DuckDuckGo 未解析到结果')
  return hits
}

/** 免费源 2：Bing 中文版 RSS（结构稳定，作兜底） */
async function searchBing(query: string): Promise<WebSearchHit[]> {
  const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setmkt=zh-CN`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`Bing 返回 ${res.status}`)
  const xml = await res.text()
  const hits: WebSearchHit[] = []
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) && hits.length < 10) {
    const title = stripTags(m[1])
    const url = m[2].trim()
    const snippet = stripTags(m[3])
    if (title && url.startsWith('http')) hits.push({ title, url, snippet })
  }
  if (!hits.length) throw new Error('Bing 未解析到结果')
  return hits
}

/** 博查（Bocha）付费搜索 */
async function searchBocha(query: string, apiKey: string): Promise<WebSearchHit[]> {
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count: 10, summary: true }),
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`博查返回 ${res.status}`)
  const json = (await res.json()) as { data?: { webPages?: { value?: { name?: string; url?: string; summary?: string; snippet?: string }[] } } }
  return (json.data?.webPages?.value || [])
    .map((v) => ({ title: String(v.name || ''), url: String(v.url || ''), snippet: String(v.summary || v.snippet || '') }))
    .filter((h) => h.title && h.url)
}

/** Tavily 付费搜索 */
async function searchTavily(query: string, apiKey: string): Promise<WebSearchHit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 10 }),
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`Tavily 返回 ${res.status}`)
  const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  return (json.results || [])
    .map((v) => ({ title: String(v.title || ''), url: String(v.url || ''), snippet: String(v.content || '').slice(0, 300) }))
    .filter((h) => h.title && h.url)
}

/** 联网搜索入口：按配置选源，免费源自动兜底 */
export async function webSearch(query: string): Promise<WebSearchHit[]> {
  const q = query.trim()
  if (!q) throw new Error('搜索词为空')
  const { search } = getConfig()
  const errors: string[] = []
  if (search.provider === 'bocha' && search.apiKey) {
    try {
      return await searchBocha(q, search.apiKey)
    } catch (e) {
      errors.push(`博查：${(e as Error).message}`)
    }
  } else if (search.provider === 'tavily' && search.apiKey) {
    try {
      return await searchTavily(q, search.apiKey)
    } catch (e) {
      errors.push(`Tavily：${(e as Error).message}`)
    }
  }
  // 免费源（或付费源失败时兜底）
  try {
    return await searchDuck(q)
  } catch (e) {
    errors.push(`DuckDuckGo：${(e as Error).message}`)
  }
  try {
    return await searchBing(q)
  } catch (e) {
    errors.push(`Bing：${(e as Error).message}`)
  }
  throw new Error(`全部搜索源失败 → ${errors.join('；')}`)
}

/** 抓取网页正文：去脚本样式与标签，压缩空白后截断（限 2MB，拒绝内网地址） */
export async function readWebpage(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) throw new Error('仅支持 http/https 链接')
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    throw new Error('链接无效')
  }
  const privateHost =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    host.startsWith('0.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  if (privateHost) throw new Error('不允许读取内网/本机地址')
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`网页返回 ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!/text\/html|text\/plain|application\/xhtml/i.test(ct)) throw new Error(`不支持的内容类型：${ct.split(';')[0]}`)
  // 流式读取并限量，防超大页面撑爆内存
  const MAX_BYTES = 2 * 1024 * 1024
  let html = ''
  const reader = res.body?.getReader()
  if (reader) {
    const dec = new TextDecoder()
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      html += dec.decode(value, { stream: true })
      if (bytes > MAX_BYTES) {
        void reader.cancel()
        break
      }
    }
    html += dec.decode()
  } else {
    html = await res.text()
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  if (!text) throw new Error('未能提取到正文')
  return decodeEntities(text).slice(0, 8000)
}

/** 是否支持「服务商自带联网搜索」，返回给设置页展示用 */
export function providerSearchSupported(baseUrl: string, protocol: SearchProtocol = 'auto'): boolean {
  return providerSearchPatch(baseUrl, protocol) !== null
}

/**
 * 服务商自带联网搜索的请求参数映射。
 * 两种来源：① 服务商卡片上显式指定的协议（searchProtocol）；② 未指定时按 baseUrl 域名自动识别。
 * 参数均核对自各家 2026-09 官方文档：
 * - Kimi（moonshot）：tools 声明 builtin_function $web_search，¥0.03/次，模型返回 tool_calls 后需把 arguments 原样回传
 * - 智谱（bigmodel）：tools 声明 web_search 工具，平台侧执行，对客户端透明
 * - MiMo（xiaomimimo）：tools 声明 web_search 工具（需在 MiMo 控制台开通联网服务插件），平台侧执行
 * - 通义（dashscope）：顶层 enable_search: true
 * DeepSeek 等厂商的开放 API 没有服务端联网，识别不到就返回 null（联网只在自家网页/App 里）。
 * 返回 null 表示该厂商不支持或未识别。
 */
export type SearchProtocol = 'auto' | 'none' | 'moonshot' | 'bigmodel' | 'mimo' | 'dashscope'

export function providerSearchPatch(
  baseUrl: string,
  protocol: SearchProtocol = 'auto'
): { tools?: unknown[]; extra?: Record<string, unknown> } | null {
  // 显式协议优先：用户可以在自定义服务商上手动指定协议（自定义网关 / 代理同厂商协议时用得上）
  if (protocol === 'none') return null
  if (protocol === 'moonshot') return { tools: [{ type: 'builtin_function', function: { name: '$web_search' } }] }
  if (protocol === 'bigmodel') return { tools: [{ type: 'web_search', web_search: { enable: true } }] }
  // force_search 省略 = 意图识别，由模型自主判断是否搜索
  if (protocol === 'mimo') return { tools: [{ type: 'web_search', max_keyword: 3 }] }
  if (protocol === 'dashscope') return { extra: { enable_search: true } }

  const host = baseUrl.toLowerCase()
  if (host.includes('moonshot.cn') || host.includes('moonshot.ai') || host.includes('kimi.com')) {
    return { tools: [{ type: 'builtin_function', function: { name: '$web_search' } }] }
  }
  if (host.includes('bigmodel.cn')) {
    return { tools: [{ type: 'web_search', web_search: { enable: true } }] }
  }
  if (host.includes('xiaomimimo.com') || host.includes('mimo.mi.com')) {
    return { tools: [{ type: 'web_search', max_keyword: 3 }] }
  }
  if (host.includes('dashscope.aliyuncs.com')) {
    return { extra: { enable_search: true } }
  }
  return null
}
