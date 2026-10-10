// 人类信号密度打分器（移植自朱雀对抗调研 ai-flavor-clear/detect.py 思路，TS 重写）
// 明确声明：本打分器是自检指引，不是朱雀代理。最终 AI 率以检测器官网实测为准。
// 正文（fiction）与文章（article）两套规则：
//  - 正文：爆发度剔除对话行；疑虑/口语/离题只统计对话层；红牌侧重叙述层毒句式
//  - 文章：全文统计；红牌侧重论说层套话（连接词/总结升华/悬浮概括）

export type Genre = 'fiction' | 'article'

export interface RedCard {
  key: string
  label: string
  sample: string
  hint: string
}
export interface SubSignal {
  key: string
  label: string
  score: number // 0-1
  hint: string
}
export interface SignalResult {
  score: number // 0-100 人类信号密度（越高越像人）
  subs: SubSignal[]
  redCards: RedCard[]
  warnings: string[]
  stats: { chars: number; sentences: number; avgLen: number; cv: number; dialogueRatio: number }
}

interface Sent {
  text: string
  len: number
  isDialogue: boolean
}

/** 分句：按句末标点与换行切；对话行 = 含「」/“”引号包住的内容的行 */
function splitSentences(text: string): Sent[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const out: Sent[] = []
  for (const line of lines) {
    const isDialogue = /[「“][^」”]+[」”]/.test(line)
    const parts = line.split(/(?<=[。！？；…])/).filter((s) => s.trim())
    for (const part of parts) {
      const t = part.trim()
      if (!t) continue
      // 对话行内进一步拆出引号内台词
      const quotes = t.match(/[「“][^」”]+[」”]/g)
      if (isDialogue && quotes) {
        for (const q of quotes) {
          const inner = q.slice(1, -1)
          out.push({ text: inner, len: inner.replace(/[，、：\s]/g, '').length, isDialogue: true })
        }
        const rest = t.replace(/[「“][^」”]+[」”]/g, '').trim()
        if (rest.length >= 2) out.push({ text: rest, len: rest.length, isDialogue: false })
      } else {
        out.push({ text: t, len: t.replace(/[，、：\s]/g, '').length, isDialogue })
      }
    }
  }
  return out
}

const countHits = (text: string, patterns: RegExp[]): number =>
  patterns.reduce((n, re) => n + (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))?.length || 0), 0)

// ============ 词库外置：userData/词库.json 的追加项（词字符串 + 自定义红牌），编译失败静默跳过 ============
export interface LexiconOverrides {
  redCards?: { key: string; label: string; pattern: string; hint: string; genres?: string[] }[]
  dialogDoubt?: string[]
  dialogDigress?: string[]
  dialogVoice?: string[]
  articleDoubt?: string[]
  articleDigress?: string[]
  articleVoice?: string[]
}

function compileWords(words: string[] | undefined): RegExp[] {
  return (words || [])
    .map((w) => {
      try {
        return new RegExp(w)
      } catch {
        return null
      }
    })
    .filter((r): r is RegExp => !!r)
}

// ============ 信号词表（正文/文章共用 + 各自侧重） ============
const DIALOG_DOUBT = [/说实话/, /说真的/, /讲真/, /坦白/, /我也不知道/, /说不好/, /拿不准/, /未必/, /说不清/, /天知道/, /谁知道呢/]
const DIALOG_DIGRESS = [/说起来/, /讲到这/, /插一句/, /扯远了/, /对了[,，]?/, /话说/, /有回/, /那天/, /诶对了/]
const DIALOG_VOICE = [/你问我/, /你别说/, /老话说/, /啥/, /咋/, /咱/, /甭/, /呗/, /嘛[。！？，]/, /这不/, /得了/]
const ARTICLE_DOUBT = [/说实话[,，]?我/, /我自己也/, /拿不准/, /说不好/, /未必/, /我也没完全想明白/, /这话听着有点刺耳/, /我有时候觉得/, /我一直觉得/]
const ARTICLE_DIGRESS = [/说起来/, /插一句/, /扯远了/, /对了[,，]?/, /顺带/, /岔开一句/]
const ARTICLE_VOICE = [/你想想看/, /我跟你说/, /怎么说呢/, /其实吧/, /这玩意/, /我是真的觉得/, /反正我觉得/, /很多朋友/, /可能有小伙伴/]
// 具体性：年份数字人名式专有（千字 6 处满分）
const SPECIFIC = [/\d{4}\s*年/, /\d+(\.\d+)?\s*(个|位|名|人|次|章|字|天|日|岁|米|斤|两|块|成)/, /[「“][^」”]{1,6}[」”]/, /第[一二三四五六七八九十百千\d]+[章节回落]/, /[A-Z][a-z]+/]

// ============ 红牌（出现即警告，不计正分） ============
interface RedRule {
  key: string
  label: string
  pattern: RegExp
  hint: string
  genres: Genre[]
}
const RED_RULES: RedRule[] = [
  { key: 'notA-butB', label: '「不是A，而是B」', pattern: /不是[^。！？，]{1,18}[，,]?\s*(?:不是[^。！？，]{1,18}[，,]?\s*)*而是/, hint: '三毒句式之首：假靶子/同义替换/硬凑。删前半句直接写B，或改「不仅是A更是B」', genres: ['fiction', 'article'] },
  { key: 'elegant-parallel', label: '同构排比三连', pattern: /有的[^。；]{1,20}有的[^。；]{1,20}有的|一边[^。；]{1,20}一边[^。；]{1,20}一边/, hint: '优雅工整排比是朱雀最敏感信号（实测100% AI）。保留最强一条，其余改写成参差句', genres: ['fiction', 'article'] },
  { key: 'eye-flash', label: '「眼中闪过一丝」', pattern: /(眼中|眼里|眼底|眸中|眸子)里?闪过一?[丝抹缕]?/, hint: '三字鉴定词级AI指纹。改成动作：他垂下眼 / 他笑了一下，没到眼底', genres: ['fiction'] },
  { key: 'mouth-curve', label: '「嘴角勾起一抹」', pattern: /嘴角(勾起|微微?上扬|掠过)/, hint: '同上。白描：他笑了，没到眼底', genres: ['fiction'] },
  { key: 'heart-surge', label: '「心中涌起一股」', pattern: /(心中|心头|心底)(涌起|泛起|掠过|一震|一动|一紧|暗道)/, hint: '情绪外化套话。用身体反应：手在抖 / 攥紧拳头', genres: ['fiction'] },
  { key: 'dai-zhe', label: '「，带着…」万能状语', pattern: /，带着(一[丝抹股种]|某种|几分)/, hint: '拆成短句或换动作', genres: ['fiction'] },
  { key: 'shen-xi', label: '「深吸一口气」', pattern: /深吸(了一口|一口)气?/, hint: '一级禁用动作。换成具体动作', genres: ['fiction'] },
  { key: 'sh-仿佛一般', label: '「仿佛…一般」', pattern: /(仿佛|犹如|宛若|如同)[^。！？]{1,24}(一般|般|似的)/, hint: '默认删掉比喻改白描。有真实生活逻辑关联的比喻才保留', genres: ['fiction'] },
  { key: 'bu-rong-zhi-yi', label: '「不容置疑」', pattern: /不容置疑|不容置喙|不易察觉/, hint: '判断类AI词。直接写声音/动作特征', genres: ['fiction'] },
  { key: 'mech-connect', label: '机械连接词', pattern: /(首先|其次|再者)[，、]|综上所述|总而言之|值得一提的是|值得注意的是|不难发现|由此可见|不可否认的是|毋庸置疑/, hint: '报幕词。删掉直接说内容；并列改隐性衔接', genres: ['article'] },
  { key: 'xuan-hua', label: '升华套话', pattern: /(影响深远|意义重大|不言而喻|这引发了广泛|具有十分重要的意义|在当今[^。]{0,10}的时代|随着[^。]{0,12}的不断发展)/, hint: '虚假宣告：只宣布重要性没给内容。删掉或换具体事实', genres: ['article'] },
  { key: 'fu-yan', label: '悬浮概括', pattern: /(通过[^。]{1,12}来?实现|赋能|抓手|闭环|助力[^。]{0,8}发展|深入探讨)/, hint: '黑话句式。换成具体的人做的事', genres: ['article'] },
  { key: 'ni-shuo', label: '「你以为A，实际上B」', pattern: /你以为[^。！？]{1,30}[，,]?\s*实际(上|是)/, hint: '把读者当傻子。删前半句直接说B', genres: ['article'] },
  { key: 'zi-wen-zi-da', label: '自问自答老师腔', pattern: /(这叫什么|说明什么|怎么办到的|看明白了吗|看到没有)[？?]/, hint: '自己提问自己回答，一篇文章问十次。删掉提问直接陈述', genres: ['article'] }
]

const WEIGHTS: Record<Genre, { key: string; label: string; w: number; threshold: number }[]> = {
  // 权重来自 detect.py 实测迭代；正文模式下疑虑/离题/口语统计对话层
  fiction: [
    { key: 'specificity', label: '具体性', w: 0.3, threshold: 6 },
    { key: 'burstiness', label: '爆发度', w: 0.22, threshold: 0.6 },
    { key: 'doubt', label: '疑虑', w: 0.13, threshold: 3 },
    { key: 'voice', label: '口语声', w: 0.13, threshold: 3 },
    { key: 'digress', label: '离题', w: 0.12, threshold: 2 },
    { key: 'imperfect', label: '不完美', w: 0.1, threshold: 2 }
  ],
  article: [
    { key: 'specificity', label: '具体性', w: 0.3, threshold: 6 },
    { key: 'burstiness', label: '爆发度', w: 0.22, threshold: 0.6 },
    { key: 'doubt', label: '疑虑', w: 0.13, threshold: 3 },
    { key: 'voice', label: '口语声', w: 0.13, threshold: 2 },
    { key: 'digress', label: '离题', w: 0.12, threshold: 2 },
    { key: 'imperfect', label: '不完美', w: 0.1, threshold: 2 }
  ]
}

function cv(nums: number[]): number {
  if (nums.length < 2) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  if (mean <= 0) return 0
  const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nums.length
  return Math.sqrt(variance) / mean
}

export function analyzeHumanSignal(rawText: string, genre: Genre, lex?: LexiconOverrides): SignalResult {
  const text = rawText.trim()
  const sents = splitSentences(text)
  const chars = text.replace(/\s/g, '').length
  const narrative = sents.filter((s) => !s.isDialogue) // 叙述层
  const dialogue = sents.filter((s) => s.isDialogue) // 对话层
  const dialogueChars = dialogue.reduce((a, s) => a + s.len, 0)
  const dialogueRatio = chars ? dialogueChars / chars : 0

  // 爆发度：正文剔除对话行（对话天然短，混入会虚高）；文章全量
  const burstPool = (genre === 'fiction' ? narrative : sents).map((s) => s.len).filter((n) => n > 0)
  const burstCv = cv(burstPool)

  // 具体性：全文（千字 6 处满分）
  const specHits = countHits(text, SPECIFIC)
  const specScore = Math.min(1, specHits / Math.max(1, (chars / 1000) * 6))

  // 疑虑/口语/离题：正文查对话层，文章查全文（词库外置追加项并入）
  const doubtText = (genre === 'fiction' ? dialogue : sents).map((s) => s.text).join('\n')
  const doubtHits = countHits(doubtText, [...(genre === 'fiction' ? DIALOG_DOUBT : ARTICLE_DOUBT), ...compileWords(genre === 'fiction' ? lex?.dialogDoubt : lex?.articleDoubt)])
  const digressHits = countHits(doubtText, [...(genre === 'fiction' ? DIALOG_DIGRESS : ARTICLE_DIGRESS), ...compileWords(genre === 'fiction' ? lex?.dialogDigress : lex?.articleDigress)])
  const voiceHits = countHits(doubtText, [...(genre === 'fiction' ? DIALOG_VOICE : ARTICLE_VOICE), ...compileWords(genre === 'fiction' ? lex?.dialogVoice : lex?.articleVoice)])

  // 不完美：碎片句（≤6 字非对话）+ 超长句（≥48 字非对话），按句数归一（封顶曲线放缓，避免普遍触顶无区分度）
  const pool = genre === 'fiction' ? narrative : sents
  const frags = pool.filter((s) => s.len > 0 && s.len <= 6).length
  const longs = pool.filter((s) => s.len >= 48).length
  const imperfScore = Math.min(1, ((frags + longs) / (pool.length || 1)) * 1.5)

  const subScores: Record<string, number> = {
    specificity: specScore,
    burstiness: Math.min(1, burstCv / 1.0),
    doubt: Math.min(1, doubtHits / 3),
    voice: Math.min(1, voiceHits / (genre === 'fiction' ? 3 : 2)),
    digress: Math.min(1, digressHits / 2),
    imperfect: imperfScore
  }

  // 红牌（内置规则 + 词库外置追加规则，编译失败的跳过）
  const redCards: RedCard[] = []
  const extraRules: RedRule[] = (lex?.redCards || [])
    .map((r) => {
      try {
        return { key: r.key || 'custom', label: r.label || r.pattern, pattern: new RegExp(r.pattern), hint: r.hint || '自定义红牌', genres: (r.genres as Genre[]) || ['fiction', 'article'] }
      } catch {
        return null
      }
    })
    .filter((r): r is RedRule => !!r)
  for (const rule of [...RED_RULES, ...extraRules]) {
    if (!rule.genres.includes(genre)) continue
    const m = text.match(new RegExp(rule.pattern.source, 'gi'))
    if (m) redCards.push({ key: rule.key, label: rule.label, sample: m[0].slice(0, 40), hint: rule.hint })
  }

  const subs: SubSignal[] = WEIGHTS[genre].map((w) => ({
    key: w.key,
    label: w.label,
    score: subScores[w.key] ?? 0,
    hint:
      w.key === 'specificity'
        ? '塞具体人名/年份/数字/地点，千字 6 处满分（降困惑度最狠的一招）'
        : w.key === 'burstiness'
            ? '句长落差拉大：偶尔碎片句、偶尔一口气长句（CV≥1.0 满分，0.6 及格）'
          : w.key === 'doubt'
            ? genre === 'fiction'
              ? '角色台词里加「说实话/拿不准/谁知道呢」'
              : '作者声音加「我自己也没完全想明白/这话听着有点刺耳」'
            : w.key === 'voice'
              ? genre === 'fiction'
                ? '台词要像活人说话：啥/咋/你别说（仅对话层）'
                : '作者语态：你想想看/我跟你说/怎么说呢'
              : w.key === 'digress'
                ? genre === 'fiction'
                  ? '台词允许跑题插话；叙述层的离题用闲笔'
                  : '允许插一句不相干的真实小事再拉回来'
                : '碎片句、断尾、一口气长句，别每句都工整'
  }))

  const score = Math.round(subs.reduce((acc, s) => acc + s.score * (WEIGHTS[genre].find((w) => w.key === s.key)?.w || 0), 0) * 100)

  const warnings: string[] = []
  for (const s of subs) {
    if (s.score < 0.4) warnings.push(`【${s.label}】偏弱：${s.hint}`)
  }
  if (genre === 'fiction' && dialogueRatio < 0.08 && chars > 800) {
    warnings.push('对话占比过低：长篇叙述层撑满全篇，爆发度与活人感都难做。适当加几轮对手戏')
  }
  for (const rc of redCards) warnings.push(`【红牌】${rc.label}：${rc.sample}… → ${rc.hint}`)
  if (!warnings.length) warnings.push('六项子分健康，无红牌。但本分数只是自检指引——定稿请去朱雀官网实测为准')

  return {
    score,
    subs,
    redCards,
    warnings,
    stats: { chars, sentences: sents.length, avgLen: burstPool.length ? Math.round(burstPool.reduce((a, b) => a + b, 0) / burstPool.length) : 0, cv: Math.round(burstCv * 100) / 100, dialogueRatio: Math.round(dialogueRatio * 100) / 100 }
  }
}
