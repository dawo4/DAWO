// 向量语义检索：OpenAI 兼容 /embeddings + 本地暴力余弦（零原生依赖）。
// 索引按书存 .inkdesk/vectors.json：正文/大纲/设定/角色等文稿逐块 + 资源库（技能/素材/便签）逐条。
// 未配置「向量化」任务通道时所有语义功能优雅降级：调用方拿到空结果与原因说明。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, rmSync } from 'fs'
import { join, normalize, sep } from 'path'
import { getConfig, AppConfig } from './config'
import { getLibraryRoot, readTextAuto } from './library'
import { LIB_LABEL, LibKind, kindRootPath, listLibrary } from './materials'
import { estimateTokens, recordCall } from './ailog'

// ============ 索引数据结构 ============

interface VecChunk {
  /** `b:{path}:{offset}` / `l:{kind}:{groupPath}:{offset}` */
  id: string
  /** book=本书文稿；lib=全局资源库条目 */
  src: 'book' | 'lib'
  /** 书内相对路径 / 库条目 `${kind}:${group}/${file}` */
  path: string
  /** 展示名（章节标题或库名） */
  title: string
  /** 在原文中的字符偏移（展示用） */
  offset: number
  text: string
  /** 归一化后的向量（点积即余弦相似度） */
  vec: number[]
}

interface VecIndex {
  version: 1
  model: string
  dim: number
  builtAt: string
  updatedAt: string
  /** 来源指纹：路径 → { 内容长度, mtime }，变了才重新嵌入 */
  fps: Record<string, { len: number; mtime: number }>
  chunks: VecChunk[]
}

// ============ 行为配置（设置 → AI 服务 → 向量化检索） ============

type EmbeddingOpts = AppConfig['embeddingOpts']

/** 读取并兜底清洗向量化行为配置：越界数值拉回合法区间，缺省用默认值 */
function vecOpts(): EmbeddingOpts {
  const raw = (getConfig().embeddingOpts || {}) as Partial<EmbeddingOpts>
  const num = (v: unknown, d: number, min: number, max: number): number => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d
  }
  return {
    includeLib: raw.includeLib !== false,
    chunkFull: num(raw.chunkFull, 3000, 500, 20000),
    winSize: num(raw.winSize, 1500, 300, 8000),
    minScore: typeof raw.minScore === 'number' && raw.minScore >= 0 && raw.minScore <= 1 ? raw.minScore : 0.3,
    injectBeat: raw.injectBeat !== false,
    topKBeat: num(raw.topKBeat, 5, 1, 20),
    injectAgent: raw.injectAgent !== false,
    topKAgent: num(raw.topKAgent, 4, 1, 20),
    injectSearch: raw.injectSearch !== false,
    topKSearch: num(raw.topKSearch, 6, 1, 20)
  }
}

// ============ 分块规则：≤整章上限整块，超出按滑窗（段界贴齐，15% 重叠） ============

const MIN_CHUNK = 30

function chunkBody(text: string): { offset: number; text: string }[] {
  const { chunkFull, winSize } = vecOpts()
  const overlap = Math.max(100, Math.round(winSize * 0.15))
  const t = text.trim()
  if (!t) return []
  if (t.length <= chunkFull) return [{ offset: 0, text: t }]
  const out: { offset: number; text: string }[] = []
  let start = 0
  while (start < t.length) {
    let end = Math.min(start + winSize, t.length)
    if (end < t.length) {
      // 尽量贴齐段落/句子边界，切块更完整
      const slice = t.slice(start, end)
      const brk = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('。'))
      if (brk > winSize * 0.5) end = start + brk + 1
    }
    const seg = t.slice(start, end).trim()
    if (seg.length >= MIN_CHUNK) out.push({ offset: start, text: seg })
    if (end >= t.length) break
    start = end - overlap
  }
  return out
}

/** 文稿首行有内容的文字当展示标题（章节标题行） */
function firstHeading(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim()
    if (t) return t.slice(0, 40)
  }
  return ''
}

// ============ 安全路径（与 library.ts 同规则） ============

function bookDir(book: string): string {
  const t = String(book || '')
  if (!t || /[\\/:*?"<>|]/.test(t)) throw new Error('非法作品名')
  const root = normalize(getLibraryRoot())
  const p = normalize(join(root, t))
  if (!p.startsWith(root + sep)) throw new Error('非法作品路径')
  return p
}

function indexPath(book: string): string {
  return join(bookDir(book), '.inkdesk', 'vectors.json')
}

function loadIndex(book: string): VecIndex | null {
  try {
    const p = indexPath(book)
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as VecIndex
    if (!raw || raw.version !== 1 || !Array.isArray(raw.chunks)) return null
    return raw
  } catch {
    return null
  }
}

function saveIndex(book: string, idx: VecIndex): void {
  mkdirSync(join(bookDir(book), '.inkdesk'), { recursive: true })
  const p = indexPath(book)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(idx), 'utf-8')
  renameSync(tmp, p)
}

// ============ 嵌入服务（独立于对话模型的服务商列表） ============

interface EmbedEndpoint {
  /** 展示名（AI 调用记录里的「服务商」） */
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

function embedEndpoint(): EmbedEndpoint | null {
  const config = getConfig()
  const es = config.embeddingService
  if (es?.baseUrl && es?.model) {
    return { name: '向量化服务', baseUrl: es.baseUrl, apiKey: es.apiKey || '', model: es.model }
  }
  // 兼容：未迁移完成的老配置仍绑在服务商列表上
  const old = config.tasks?.embedding
  if (old?.providerId && old?.model) {
    const provider = config.providers.find((p) => p.id === old.providerId)
    if (provider) return { name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey || '', model: old.model }
  }
  return null
}

export function embeddingConfigured(): boolean {
  return !!embedEndpoint()
}

function normalizeVec(v: number[]): number[] {
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum) || 1
  // 保留 5 位小数：精度对余弦排序绰绰有余，索引体积减半
  return v.map((x) => Math.round((x / norm) * 1e5) / 1e5)
}

async function embedBatch(ep: EmbedEndpoint, texts: string[]): Promise<number[][]> {
  const baseUrl = ep.baseUrl.replace(/\/+$/, '')
  const startedAt = Date.now()
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}) },
      body: JSON.stringify({ model: ep.model, input: texts }),
      signal: AbortSignal.timeout(60000)
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      const hint = res.status === 401 ? '（API Key 无效或未填）' : res.status === 404 ? '（接口地址不支持 /embeddings 或模型名有误）' : ''
      throw new Error(`接口返回 ${res.status}${hint}：${t.slice(0, 200)}`)
    }
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] }
    const data = (json.data || []).slice().sort((a, b) => a.index - b.index)
    if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding) || !d.embedding.length)) {
      throw new Error('嵌入接口返回数据不完整')
    }
    recordCall({
      kind: 'text',
      feature: 'embedding',
      featureLabel: '向量化检索',
      provider: ep.name,
      model: ep.model,
      ok: true,
      status: 'success',
      durationMs: Date.now() - startedAt,
      tokens: estimateTokens(texts.join('').length),
      tokensEstimated: true,
      error: ''
    })
    return data.map((d) => normalizeVec(d.embedding))
  } catch (e) {
    recordCall({
      kind: 'text',
      feature: 'embedding',
      featureLabel: '向量化检索',
      provider: ep.name,
      model: ep.model,
      ok: false,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      tokens: estimateTokens(texts.join('').length),
      tokensEstimated: true,
      error: (e as Error).message
    })
    throw e
  }
}

// ============ 来源枚举 ============

interface Source {
  key: string
  src: 'book' | 'lib'
  path: string
  title: string
  text: string
  /** 内容长度：指纹命中跳读时用缓存值（text 为空串） */
  len: number
  mtime: number
}

type Fps = Record<string, { len: number; mtime: number }>

/** 指纹命中（mtime 基本一致）= 上次同步后没变过，不必重读全文 */
function fpHit(fps: Fps | undefined, key: string, mtime: number): { len: number; mtime: number } | null {
  const fp = fps?.[key]
  if (!fp || Math.abs(fp.mtime - mtime) > 1) return null
  return fp
}

function bookSources(book: string, fps?: Fps): Source[] {
  const out: Source[] = []
  const walk = (dir: string, rel: string) => {
    const base = rel ? join(dir, rel) : dir
    let names: string[] = []
    try {
      names = readdirSync(base)
    } catch {
      return
    }
    for (const name of names) {
      if (name === '.inkdesk' || name === 'book.json') continue
      const p = join(base, name)
      let isDir = false
      try {
        isDir = statSync(p).isDirectory()
      } catch {
        continue
      }
      const next = rel ? `${rel}/${name}` : name
      if (isDir) walk(dir, next)
      else if (/\.(md|txt)$/i.test(name)) {
        try {
          const key = `b:${next}`
          const mtime = statSync(p).mtimeMs
          const hit = fpHit(fps, key, mtime)
          if (hit) {
            out.push({ key, src: 'book', path: next, title: '', text: '', len: hit.len, mtime })
            continue
          }
          const text = readTextAuto(p)
          out.push({
            key,
            src: 'book',
            path: next,
            title: firstHeading(text) || next.replace(/\.(md|txt)$/i, ''),
            text,
            len: text.length,
            mtime
          })
        } catch {
          /* 单文件读取失败跳过 */
        }
      }
    }
  }
  walk(bookDir(book), '')
  return out
}

const LIB_KINDS: LibKind[] = ['skills', 'materials', 'notes']

function libSources(fps?: Fps): Source[] {
  const out: Source[] = []
  for (const kind of LIB_KINDS) {
    try {
      const root = kindRootPath(kind)
      for (const g of listLibrary(kind)) {
        for (const e of g.entries) {
          try {
            const p = join(root, e.path)
            const key = `l:${kind}:${e.path}`
            const mtime = statSync(p).mtimeMs
            const hit = fpHit(fps, key, mtime)
            if (hit) {
              out.push({ key, src: 'lib', path: `${kind}:${e.path}`, title: '', text: '', len: hit.len, mtime })
              continue
            }
            const raw = readFileSync(p, 'utf-8')
            // 去掉 frontmatter 头再入库，避免元信息噪音
            const body = raw.startsWith('---') ? raw.slice(raw.indexOf('\n---', 3) + 4).trim() : raw.trim()
            if (!body) continue
            out.push({
              key,
              src: 'lib',
              path: `${kind}:${e.path}`,
              title: `${LIB_LABEL[kind]} · ${e.name}`,
              text: body,
              len: body.length,
              mtime
            })
          } catch {
            /* 单条目失败跳过 */
          }
        }
      }
    } catch {
      /* 某个库不可读不影响整体 */
    }
  }
  return out
}

// ============ 索引构建 / 增量同步 ============

const syncing = new Map<string, Promise<{ stale: boolean; error: string }>>()

function allSources(book: string, fps?: Fps): Source[] {
  return vecOpts().includeLib ? [...bookSources(book, fps), ...libSources(fps)] : bookSources(book, fps)
}

/** 指纹一致的块原样保留，变化的重新分块嵌入，消失的删除 */
function diffChunks(idx: VecIndex, sources: Source[]): { keep: VecChunk[]; changed: Source[] } {
  const keep: VecChunk[] = []
  const changedKeys = new Set<string>()
  const srcByKey = new Map(sources.map((s) => [s.key, s]))
  for (const [key, fp] of Object.entries(idx.fps)) {
    const s = srcByKey.get(key)
    if (!s || s.len !== fp.len || Math.abs(s.mtime - fp.mtime) > 1) changedKeys.add(key)
  }
  for (const s of sources) if (!idx.fps[s.key] || changedKeys.has(s.key)) changedKeys.add(s.key)
  for (const c of idx.chunks) {
    const baseKey = c.id.slice(0, c.id.lastIndexOf(':'))
    if (!changedKeys.has(baseKey)) keep.push(c)
  }
  return { keep, changed: sources.filter((s) => changedKeys.has(s.key)) }
}

async function chunksFor(ep: EmbedEndpoint, sources: Source[]): Promise<VecChunk[]> {
  const pieces: { key: string; src: 'book' | 'lib'; path: string; title: string; offset: number; text: string }[] = []
  for (const s of sources) {
    for (const c of chunkBody(s.text)) pieces.push({ key: s.key, src: s.src, path: s.path, title: s.title, offset: c.offset, text: c.text })
  }
  const out: VecChunk[] = []
  const BATCH = 16
  for (let i = 0; i < pieces.length; i += BATCH) {
    const batch = pieces.slice(i, i + BATCH)
    const vecs = await embedBatch(ep, batch.map((p) => p.text))
    batch.forEach((p, j) => {
      out.push({ id: `${p.key}:${p.offset}`, src: p.src, path: p.path, title: p.title, offset: p.offset, text: p.text, vec: vecs[j] })
    })
  }
  return out
}

/**
 * 增量同步索引。换模型时返回 stale=true（向量空间不同，必须手动重建，防止混用两个模型的向量）。
 * 同一本书并发调用会合并成一次。
 */
function syncIndex(book: string, opts: { force?: boolean } = {}): Promise<{ stale: boolean; error: string }> {
  const existing = syncing.get(book)
  if (existing && !opts.force) return existing
  const job = (async (): Promise<{ stale: boolean; error: string }> => {
    const ep = embedEndpoint()
    if (!ep) return { stale: false, error: '未配置向量化' }
    const model = ep.model
    let idx = loadIndex(book)
    if (!idx || opts.force) {
      // 全量构建：不带指纹缓存，读全部内容
      const sources = allSources(book)
      const chunks = await chunksFor(ep, sources)
      idx = {
        version: 1,
        model,
        dim: chunks[0]?.vec.length || 0,
        builtAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fps: Object.fromEntries(sources.map((s) => [s.key, { len: s.len, mtime: s.mtime }])),
        chunks
      }
      saveIndex(book, idx)
      return { stale: false, error: '' }
    }
    if (idx.model !== model) return { stale: true, error: '向量化模型已更换，索引需重建' }
    // 增量同步：指纹没变的来源跳过读文件，只 stat
    const sources = allSources(book, idx.fps)
    const { keep, changed } = diffChunks(idx, sources)
    if (!changed.length) return { stale: false, error: '' }
    const fresh = await chunksFor(ep, changed)
    idx.chunks = [...keep, ...fresh]
    idx.dim = idx.chunks[0]?.vec.length || idx.dim
    idx.updatedAt = new Date().toISOString()
    const keptKeys = new Set(sources.map((s) => s.key))
    for (const k of Object.keys(idx.fps)) if (!keptKeys.has(k)) delete idx.fps[k]
    for (const s of changed) idx.fps[s.key] = { len: s.len, mtime: s.mtime }
    saveIndex(book, idx)
    return { stale: false, error: '' }
  })().finally(() => syncing.delete(book))
  syncing.set(book, job)
  return job
}

// ============ 对外能力 ============

export interface VectorHit {
  title: string
  path: string
  offset: number
  text: string
  score: number
  src: 'book' | 'lib'
}

export interface SearchResult {
  hits: VectorHit[]
  reason: string
}

/** 语义搜索：自动先做增量同步（新写的章节下一次检索就能被搜到），未配置 / 换模型返回空结果与原因 */
export async function vectorSearch(
  book: string,
  query: string,
  topK = 5,
  opts: { scope?: 'all' | 'book'; minScore?: number } = {}
): Promise<SearchResult> {
  if (!query.trim()) return { hits: [], reason: '空查询' }
  const ep = embedEndpoint()
  if (!ep) return { hits: [], reason: '未配置向量化' }
  try {
    const st = await syncIndex(book)
    if (st.stale) return { hits: [], reason: st.error }
    const idx = loadIndex(book)
    if (!idx || !idx.chunks.length) return { hits: [], reason: '索引为空（书里还没有内容）' }
    const [qv] = await embedBatch(ep, [query.slice(0, 4000)])
    const scope = opts.scope || 'all'
    const minScore = opts.minScore ?? vecOpts().minScore
    const pool = scope === 'book' ? idx.chunks.filter((c) => c.src === 'book') : idx.chunks
    const scored: VectorHit[] = []
    for (const c of pool) {
      let dot = 0
      for (let i = 0; i < qv.length; i++) dot += qv[i] * (c.vec[i] || 0)
      if (dot >= minScore) scored.push({ title: c.title, path: c.path, offset: c.offset, text: c.text, score: dot, src: c.src })
    }
    scored.sort((a, b) => b.score - a.score)
    return { hits: scored.slice(0, topK), reason: '' }
  } catch (e) {
    return { hits: [], reason: `语义检索失败：${(e as Error).message}` }
  }
}

/** 索引状态（同步、无副作用），供写作台「检索」面板 */
export function vectorStatus(book: string): {
  configured: boolean
  model: string
  hasIndex: boolean
  count: number
  bookChunks: number
  libChunks: number
  sources: number
  chars: number
  estTokens: number
  builtAt: string
  updatedAt: string
  stale: boolean
} {
  const ep = embedEndpoint()
  const idx = loadIndex(book)
  let chars = idx ? idx.chunks.reduce((n, c) => n + c.text.length, 0) : 0
  // 还没建过索引（或换模型待重建）时，现场枚举来源估算体量，让「重建成本」有个靠谱的数
  if (ep && (!idx || idx.model !== ep.model)) {
    try {
      chars = allSources(book).reduce((n, s) => n + s.len, 0)
    } catch {
      /* 书不存在等场景维持 0 */
    }
  }
  return {
    configured: !!ep,
    model: ep?.model || '',
    hasIndex: !!idx,
    count: idx?.chunks.length || 0,
    bookChunks: idx ? idx.chunks.filter((c) => c.src === 'book').length : 0,
    libChunks: idx ? idx.chunks.filter((c) => c.src === 'lib').length : 0,
    sources: idx ? Object.keys(idx.fps).length : 0,
    chars,
    estTokens: estimateTokens(chars),
    builtAt: idx?.builtAt || '',
    updatedAt: idx?.updatedAt || '',
    stale: !!ep && !!idx && idx.model !== ep.model
  }
}

/** 重建：全书 + 资源库全部重新嵌入（成本较高，UI 层负责确认） */
export async function vectorRebuild(book: string): Promise<{ ok: boolean; count: number; tokens: number; error: string }> {
  try {
    const st = await syncIndex(book, { force: true })
    if (st.error && !loadIndex(book)) return { ok: false, count: 0, tokens: 0, error: st.error }
    const idx = loadIndex(book)
    return { ok: true, count: idx?.chunks.length || 0, tokens: estimateTokens((idx ? idx.chunks.reduce((n, c) => n + c.text.length, 0) : 0)), error: '' }
  } catch (e) {
    return { ok: false, count: 0, tokens: 0, error: (e as Error).message }
  }
}

/** 增量更新：只嵌入新增 / 变化的块 */
export async function vectorUpdate(book: string): Promise<{ ok: boolean; count: number; error: string }> {
  try {
    const st = await syncIndex(book)
    const idx = loadIndex(book)
    return { ok: !st.error || !!idx, count: idx?.chunks.length || 0, error: st.error }
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error).message }
  }
}

/** 删除索引文件（换模型重建前的兜底清理用） */
export function vectorClear(book: string): void {
  try {
    const p = indexPath(book)
    if (existsSync(p)) rmSync(p)
  } catch {
    /* 忽略 */
  }
}

/** 供智能体系统提示词注入：拿作者本轮的话检索全书 + 资源库，格式化成带来源的片段列表；关闭开关 / 无结果返回空串 */
export async function semanticForPrompt(book: string, query: string, topK?: number): Promise<string> {
  const opts = vecOpts()
  if (!opts.injectAgent) return ''
  const r = await vectorSearch(book, query, topK ?? opts.topKAgent, { minScore: Math.max(0.35, opts.minScore) })
  return r.hits
    .map((h) => `· [${h.title}｜相似 ${(h.score * 100).toFixed(0)}%] ${h.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n')
}

/** 测试嵌入服务连通性：发一条最小 /embeddings 请求，端到端验证地址 / Key / 模型，顺带拿到向量维度 */
export async function testEmbedding(
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; latencyMs: number; model: string; dim: number; error: string }> {
  const trimmed = model.trim()
  const base = (baseUrl || '').replace(/\/+$/, '')
  if (!base || !trimmed) return { ok: false, latencyMs: 0, model: trimmed, dim: 0, error: '请先填写接口地址与模型名' }
  const startedAt = Date.now()
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: trimmed, input: ['ping'] }),
      signal: AbortSignal.timeout(30000)
    })
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      const hint = res.status === 401 ? '（API Key 无效或未填）' : res.status === 404 ? '（接口地址不支持 /embeddings 或模型名有误）' : ''
      return { ok: false, latencyMs, model: trimmed, dim: 0, error: `接口返回 ${res.status}${hint}：${t.slice(0, 160)}` }
    }
    const json = (await res.json()) as { data?: { embedding?: number[] }[] }
    const dim = json.data?.[0]?.embedding?.length || 0
    if (!dim) return { ok: false, latencyMs, model: trimmed, dim: 0, error: '接口通了，但返回数据里没有向量' }
    recordCall({
      kind: 'text',
      feature: 'embedding',
      featureLabel: '向量化检索',
      provider: '向量化服务',
      model: trimmed,
      ok: true,
      status: 'success',
      durationMs: latencyMs,
      tokens: estimateTokens(4),
      tokensEstimated: true,
      error: ''
    })
    return { ok: true, latencyMs, model: trimmed, dim, error: '' }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - startedAt, model: trimmed, dim: 0, error: (e as Error).message }
  }
}
