import { BrowserWindow } from 'electron'
import { getConfig, Provider, TaskCfg } from './lib/config'
import { getPrompt, renderPrompt, DEAI_LEVELS } from './lib/prompts'
import { estimateTokens, recordCall } from './lib/ailog'

const TASK_LABELS: Record<string, string> = {
  workflow: '拆书 / 资料登记',
  draft: '灵感与取名',
  structure: '建书大纲与设定',
  chapter: '逐章正文',
  continue: '智能续写',
  polish: '润色 / 扩写 / 纠错',
  deai: '去 AI 味',
  selection: '划词自定义',
  agent: '智能体对话'
}

interface RunCtx {
  controller: AbortController
}

const runs = new Map<string, RunCtx>()

export function abortRun(runId: string): void {
  const r = runs.get(runId)
  if (r) r.controller.abort()
}

export interface AiRunParams {
  runId: string
  task: 'workflow' | 'draft' | 'structure' | 'chapter' | 'continue' | 'polish' | 'deai' | 'selection'
  promptId: string
  vars: Record<string, string>
  deaiLevel?: string
  systemOverride?: string
}

function send(win: BrowserWindow, runId: string, type: string, payload?: unknown): void {
  if (!win.isDestroyed()) win.webContents.send('ai:event', { runId, type, payload })
}

export async function runAi(win: BrowserWindow, params: AiRunParams): Promise<void> {
  const { runId, task, promptId, vars } = params
  const cfg = getConfig()
  // 兜底：未知任务通道回退 workflow，避免老配置缺 key 时直接报错
  const taskCfg: TaskCfg = cfg.tasks[task] || cfg.tasks.workflow
  const taskKey = cfg.tasks[task] ? task : 'workflow'
  const provider: Provider | undefined = cfg.providers.find((p) => p.id === taskCfg.providerId)
  if (!provider || !taskCfg.model) {
    send(win, runId, 'error', '尚未配置 AI 服务：请到「设置 → AI 服务」选择服务商并填写模型名')
    return
  }

  let system = params.systemOverride || ''
  if (!system) {
    const tpl = getPrompt(promptId)
    if (!tpl) {
      send(win, runId, 'error', `提示词模板不存在：${promptId}`)
      return
    }
    const allVars = { ...vars }
    if (promptId === 'deai-rewrite' && params.deaiLevel) {
      allVars.strength = DEAI_LEVELS[params.deaiLevel] || DEAI_LEVELS.L2
    }
    system = renderPrompt(tpl, allVars)
  }
  const sensitive = cfg.sensitiveWords || []
  if (sensitive.length) {
    system += `\n\n【写作规避词】产出内容不得包含以下词语：${sensitive.join('、')}。语义上无法回避时改用同义表达。`
  }

  const controller = new AbortController()
  runs.set(runId, { controller })
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const startedAt = Date.now()
  let status: 'success' | 'failed' | 'aborted' = 'success'
  let errMsg = ''
  let full = ''
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: taskCfg.model,
        temperature: taskCfg.temperature,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: vars.input ?? '' }
        ]
      })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const hint = res.status === 401 ? '（API Key 无效或未填）' : res.status === 404 ? '（接口地址或模型名可能有误）' : ''
      throw new Error(`接口返回 ${res.status}${hint}：${text.slice(0, 300)}`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('响应无内容流')
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta ?? {}
          const content: string = delta.content ?? ''
          if (content) {
            full += content
            send(win, runId, 'chunk', content)
          } else if (delta.reasoning_content || delta.reasoning) {
            // 推理模型的思考期：不计入正文，但作为活动信号下发——
            // 否则思考期长达数分钟时渲染层收不到任何 chunk，看门狗会误杀正常请求
            send(win, runId, 'reason', '')
          }
        } catch {
          /* 忽略不完整行 */
        }
      }
    }
    send(win, runId, 'done', full)
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      status = 'aborted'
      send(win, runId, 'aborted')
    } else {
      status = 'failed'
      errMsg = `AI 请求失败：${err.message}`
      send(win, runId, 'error', errMsg)
    }
  } finally {
    runs.delete(runId)
    recordCall({
      kind: 'text',
      feature: taskKey,
      featureLabel: TASK_LABELS[task] || task,
      provider: provider.name,
      model: taskCfg.model,
      ok: status === 'success',
      status,
      durationMs: Date.now() - startedAt,
      tokens: estimateTokens((vars.input?.length || 0) + full.length + system.length),
      tokensEstimated: true,
      error: errMsg
    })
  }
}

/** 常见模型的上下文窗口（token）。云端 API 的 /models 不返回窗口大小，按模型名查表兜底。
 *  数据核对自各家官方文档（2026-09）：DeepSeek / Kimi / 智谱 / 通义 / MiMo / OpenAI / Anthropic / Gemini */
const CONTEXT_TABLE: { match: RegExp; len: number }[] = [
  // DeepSeek：chat/reasoner 现指向 V3.2（128K）；V4 系列为 1M
  { match: /^deepseek-v4/, len: 1048576 },
  { match: /^deepseek-chat|^deepseek-reasoner/, len: 131072 },
  // Kimi：k3 为 1M；K2.5/K2.6 及 K2-0905/turbo/thinking 为 256K；旧 kimi-latest / moonshot-v1 已下线仍按 128K 兼容
  { match: /^kimi-k3/, len: 1048576 },
  { match: /^kimi-k2|^kimi-latest|^moonshot-v1/, len: 262144 },
  // 智谱 GLM：5.3 / 5.2 为 1M；5.1 / 5 / 5-turbo / 4.7 / 4.6 为 200K；4.5 系列为 128K；glm-4-long 为 1M
  { match: /^glm-5\.3|^glm-5\.2|^glm-4-long/, len: 1048576 },
  { match: /^glm-5|^glm-4\.7|^glm-4\.6/, len: 204800 },
  { match: /^glm-4/, len: 131072 },
  // 通义 Qwen：3.8 / 3.5 / 3-max / plus / flash / turbo / coder-plus 均为 1M；qwen-max 为 32K；qwen2.5 开源版为 128K
  { match: /^qwen3\.\d|^qwen3-max|^qwen-plus|^qwen-flash|^qwen-turbo/, len: 1048576 },
  { match: /^qwen-max/, len: 32768 },
  { match: /^qwen2/, len: 131072 },
  // MiMo：v2.5 / v2.5-pro / v2.6 系列为 1M；v2-flash / v2-omni 为 256K
  { match: /^mimo-v2\.5|^mimo-v2\.6/, len: 1048576 },
  { match: /^mimo/, len: 262144 },
  // 海外
  { match: /^gpt-4o|^gpt-4-turbo|^o1|^o3|^o4/, len: 131072 },
  { match: /^gpt-4(?!o|-turbo)/, len: 8192 },
  { match: /^gpt-3\.5/, len: 16385 },
  { match: /^claude-3|^claude-4|^claude-sonnet|^claude-opus|^claude-haiku/, len: 200000 },
  { match: /^gemini-/, len: 1048576 }
]

/** 从模型名解析上下文窗口：先匹配已知型号，再从 -8k/-32k/-128k/-1m 等后缀解析 */
export function builtinContextLength(modelId: string): number | undefined {
  for (const t of CONTEXT_TABLE) if (t.match.test(modelId)) return t.len
  const suf = /-(\d+)(k|m)(?:$|-|_)/i.exec(modelId)
  if (suf) {
    const n = Number(suf[1])
    if (Number.isFinite(n) && n > 0) return suf[2].toLowerCase() === 'm' ? n * 1048576 : n * 1024
  }
  return undefined
}

/** 拉取服务商可用模型列表（OpenAI 兼容 /models），尽可能读取上下文窗口大小 */
export async function fetchModels(provider: Provider): Promise<{ id: string; contextLength?: number }[]> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${baseUrl}/models`, {
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
  })
  if (!res.ok) throw new Error(`接口返回 ${res.status}`)
  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  return (json.data || [])
    .map((m) => {
      const id = String(m.id || '')
      // 不同后端字段不统一：Ollama/vLLM 用 context_length，有的用 context_window / max_model_len / max_context_length
      const raw =
        (m.context_length as number | undefined) ??
        (m.context_window as number | undefined) ??
        (m.max_model_len as number | undefined) ??
        (m.max_context_length as number | undefined) ??
        ((m.max_tokens as number | undefined) && (m.max_tokens as number) > 4096 ? (m.max_tokens as number) : undefined)
      const detected = typeof raw === 'number' && raw > 0 ? Math.round(raw) : undefined
      // API 没给就按模型名查内置表
      const contextLength = detected ?? builtinContextLength(id)
      return { id, contextLength }
    })
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 测试服务商连通性：发一条最小对话请求（区别于 /models 只探地址），端到端验证密钥与模型 */
export async function testProvider(
  provider: { baseUrl: string; apiKey: string },
  model: string
): Promise<{ ok: boolean; latencyMs: number; model: string; error: string }> {
  const trimmed = model.trim()
  if (!trimmed) return { ok: false, latencyMs: 0, model: '', error: '请先填写或获取模型名' }
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const startedAt = Date.now()
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      body: JSON.stringify({ model: trimmed, stream: false, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(30000)
    })
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, latencyMs, model: trimmed, error: `接口返回 ${res.status}${text ? '：' + text.slice(0, 160) : ''}` }
    }
    await res.json().catch(() => null)
    return { ok: true, latencyMs, model: trimmed, error: '' }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - startedAt, model: trimmed, error: (e as Error).message }
  }
}
