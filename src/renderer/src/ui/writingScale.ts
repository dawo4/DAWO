/**
 * 「创意程度」档位 ↔ 采样温度。
 * 界面上不出现「温度」这个技术词，也不出现数字，只用写作者能理解的四档。
 */
export const CREATIVE_LEVELS = [
  { value: 'conservative', label: '保守', temp: 0.3, hint: '贴着已有设定与原文写，少发挥' },
  { value: 'balanced', label: '均衡', temp: 0.7, hint: '默认，兼顾稳定与变化' },
  { value: 'flexible', label: '灵活', temp: 1.0, hint: '允许跳脱，会主动给新点子' },
  { value: 'bold', label: '大胆', temp: 1.3, hint: '用词与情节更大胆，也更容易跑偏' }
]

export function tempToLevel(temp: number): string {
  let best = CREATIVE_LEVELS[1]
  let min = Number.POSITIVE_INFINITY
  for (const l of CREATIVE_LEVELS) {
    const d = Math.abs(l.temp - temp)
    if (d < min) {
      min = d
      best = l
    }
  }
  return best.value
}

export function levelToTemp(level: string): number {
  return CREATIVE_LEVELS.find((l) => l.value === level)?.temp ?? 0.7
}

export const THINKING_LEVELS = [
  { value: 'off', label: '关闭', hint: '直接给结论，不展开推演' },
  { value: 'low', label: '低', hint: '简述依据后给结论' },
  { value: 'medium', label: '中', hint: '默认，先理清取舍再动笔' },
  { value: 'high', label: '高', hint: '列出多种方向并比较代价' }
]