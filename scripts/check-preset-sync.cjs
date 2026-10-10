// 一次性校验脚本：对比 materials.ts 种子内容与用户库当前条目（防止用户改过正文后纯净版发旧版）
const fs = require('fs')
const src = fs.readFileSync('d:/deepseekwork/inkdesk/src/main/lib/materials.ts', 'utf8')
const libRoot = 'C:/Users/23867/Documents/墨案书架'
let diffs = 0, checked = 0
function parseEntry(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  return { body: (m ? m[2] : raw).trim() }
}
// 种子条目形态（数组元组）：['名称', '摘要', ['tag', ...], `正文`]
const re = /\['([^']+)',\s*'([^']*)',\s*\[([^\]]*)\],\s*`([\s\S]*?)`\]/g
const bodies = {}
let m
while ((m = re.exec(src))) bodies[m[1]] = m[4].trim()
for (const lib of ['_技能库', '_素材库']) {
  const dir = libRoot + '/' + lib
  for (const group of fs.readdirSync(dir)) {
    const gdir = dir + '/' + group
    if (!fs.statSync(gdir).isDirectory()) continue
    for (const f of fs.readdirSync(gdir)) {
      if (!f.endsWith('.md')) continue
      const name = f.replace(/\.md$/, '')
      const file = parseEntry(fs.readFileSync(gdir + '/' + f, 'utf8'))
      const seed = bodies[name]
      checked++
      if (seed === undefined) { console.log('种子中无:', name); diffs++ }
      else if (seed.replace(/\s+/g, '') !== file.body.replace(/\s+/g, '')) { console.log('内容不同:', name, '(种子', seed.length, '字 vs 文件', file.body.length, '字)'); diffs++ }
    }
  }
}
console.log('检查', checked, '条，差异', diffs, '条')
