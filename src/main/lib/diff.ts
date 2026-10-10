/** 行级差异计算：产出标准 hunk（供修改提案审阅展示） */

export type DiffLineType = 'context' | 'addition' | 'deletion'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface DiffResult {
  hunks: DiffHunk[]
  additions: number
  deletions: number
  truncated: boolean
}

const CONTEXT = 3
const MAX_LINES = 4000
const MAX_HUNKS = 40

interface Op {
  type: DiffLineType
  text: string
  oldNo: number | null
  newNo: number | null
}

/** LCS 动态规划求最短编辑脚本 */
function editScript(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length
  const m = newLines.length
  // dp[i][j] = LCS 长度（滚动数组省内存，另存方向表）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'context', text: oldLines[i], oldNo, newNo })
      i++
      j++
      oldNo++
      newNo++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'deletion', text: oldLines[i], oldNo, newNo: null })
      i++
      oldNo++
    } else {
      ops.push({ type: 'addition', text: newLines[j], oldNo: null, newNo })
      j++
      newNo++
    }
  }
  while (i < n) {
    ops.push({ type: 'deletion', text: oldLines[i], oldNo, newNo: null })
    i++
    oldNo++
  }
  while (j < m) {
    ops.push({ type: 'addition', text: newLines[j], oldNo: null, newNo })
    j++
    newNo++
  }
  return ops
}

function splitLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const truncated = oldLines.length > MAX_LINES || newLines.length > MAX_LINES
  const ops = editScript(oldLines.slice(0, MAX_LINES), newLines.slice(0, MAX_LINES))

  let additions = 0
  let deletions = 0
  for (const op of ops) {
    if (op.type === 'addition') additions++
    else if (op.type === 'deletion') deletions++
  }

  // 按变更块聚合（相邻变更间距 <= 2*CONTEXT 视为同一块）
  const changed: number[] = []
  ops.forEach((op, idx) => {
    if (op.type !== 'context') changed.push(idx)
  })
  if (!changed.length) return { hunks: [], additions: 0, deletions: 0, truncated }

  const ranges: [number, number][] = []
  let start = changed[0]
  let end = changed[0]
  for (let k = 1; k < changed.length; k++) {
    if (changed[k] - end <= CONTEXT * 2 + 1) end = changed[k]
    else {
      ranges.push([start, end])
      start = changed[k]
      end = changed[k]
    }
  }
  ranges.push([start, end])

  const hunks: DiffHunk[] = []
  for (const [s, e] of ranges.slice(0, MAX_HUNKS)) {
    const from = Math.max(0, s - CONTEXT)
    const to = Math.min(ops.length - 1, e + CONTEXT)
    const lines = ops.slice(from, to + 1).map<DiffLine>((op) => ({
      type: op.type,
      text: op.text,
      oldLineNumber: op.oldNo,
      newLineNumber: op.newNo
    }))
    const oldNums = lines.filter((l) => l.oldLineNumber != null).map((l) => l.oldLineNumber as number)
    const newNums = lines.filter((l) => l.newLineNumber != null).map((l) => l.newLineNumber as number)
    hunks.push({
      oldStart: oldNums[0] ?? 0,
      oldLines: oldNums.length,
      newStart: newNums[0] ?? 0,
      newLines: newNums.length,
      lines
    })
  }

  return { hunks, additions, deletions, truncated: truncated || ranges.length > MAX_HUNKS }
}