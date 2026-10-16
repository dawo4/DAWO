import { request as httpRequest } from 'http'

/**
 * 本地 AI 服务探测（方案 B：本地桥接）
 * 扫描本机常见端口上的 OpenAI 兼容服务，供一键接入。
 * 仅访问固定候选端口、只发 GET、短超时，不做任何用户输入拼接的请求。
 */

export interface LocalService {
  port: number
  /** 服务类型标识 */
  kind: 'workbuddy' | 'ollama' | 'openai'
  /** 展示名 */
  name: string
  baseUrl: string
  models: string[]
}

/** 候选端口 → 展示名（识别到具体服务后会被覆盖） */
const CANDIDATES: { port: number; guess: string }[] = [
  { port: 7863, guess: '本地网关' },
  { port: 11434, guess: 'Ollama' },
  { port: 1234, guess: 'LM Studio' },
  { port: 8080, guess: '本地服务' },
  { port: 8000, guess: '本地服务' }
]

/** GET http://127.0.0.1:port/path，返回解析后的 JSON（非 2xx 或超时返回 null） */
function getJson(port: number, path: string, timeoutMs: number, apiKey?: string): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (v: unknown): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      const req = httpRequest(
        { host: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            clearTimeout(timer)
            if (!res.statusCode || res.statusCode >= 400) return finish(null)
            try {
              finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch {
              finish(null)
            }
          })
        }
      )
      if (apiKey) req.setHeader('Authorization', `Bearer ${apiKey}`)
      req.on('timeout', () => {
        req.destroy()
        clearTimeout(timer)
        finish(null)
      })
      req.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      req.end()
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

function asModels(v: unknown): string[] {
  const data = (v as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data
    .map((m) => String((m as { id?: unknown })?.id || ''))
    .filter(Boolean)
    .slice(0, 200)
}

/** 扫描本机常见端口，返回发现的服务列表（并发探测，单端口约 2s 内返回）
 *  鉴权说明：/v1/models 可能需要 Key（如 WorkBuddy 网关），识别服务用免鉴权探针，
 *  模型列表拿得到就带回来，拿不到由接入后「获取模型」补。 */
export async function scanLocalServices(apiKey?: string): Promise<LocalService[]> {
  const results = await Promise.all(
    CANDIDATES.map(async ({ port, guess }): Promise<LocalService | null> => {
      const models = asModels(await getJson(port, '/v1/models', 1200, apiKey))
      let kind: LocalService['kind'] | null = models.length ? 'openai' : null
      let name = guess
      if (port === 7863) {
        const health = (await getJson(port, '/healthz', 900)) as { service?: string } | null
        if (health?.service === 'workbuddy2api') {
          kind = 'workbuddy'
          name = 'WorkBuddy 网关'
        }
      } else if (port === 11434) {
        const tags = (await getJson(port, '/api/tags', 900)) as { models?: { name?: string }[] } | null
        if (tags) {
          kind = 'ollama'
          name = 'Ollama'
          if (!models.length) {
            models.push(
              ...((tags.models || [])
                .map((m) => String(m?.name || ''))
                .filter(Boolean)
                .slice(0, 100))
            )
          }
        }
      }
      if (!kind) return null
      if (port === 1234 && kind === 'openai') name = 'LM Studio'
      return { port, kind, name, baseUrl: `http://127.0.0.1:${port}/v1`, models }
    })
  )
  return results.filter((r): r is LocalService => !!r)
}
