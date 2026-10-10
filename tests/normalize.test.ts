// normalize 层单元测试：纯函数断言，无 AI、无真实磁盘写（writeJson 不触发）
import {
  normalizeOutline,
  normalizeDict,
  normalizePower,
  normalizeTracking
} from '../src/main/lib/structured'
import { splitCharacterText, splitLegacyCharacters } from '../src/main/lib/characters'
import { setLibraryRoot } from '../src/main/lib/library'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let passed = 0
let failed = 0
function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  ✗ ${label}`)
  }
}

// ============ normalizeOutline ============
{
  const prev = [
    { id: 'a', vol: '', no: 1, title: '第一章', beat: '开局', status: '已写' as const },
    { id: 'b', vol: '', no: 2, title: '第二章', beat: '发展', status: '待写' as const }
  ]
  // preserve：AI 只提到第 1 章 → 第 2 章保留
  const r1 = normalizeOutline([{ no: 1, title: '第一章改', beat: '开局修订' }], { preserve: true, prev })
  ok(r1.length === 2, 'outline preserve：未提及章节保留')
  ok(r1.find((e) => e.no === 1)?.title === '第一章改', 'outline：按 no 认领并更新')
  ok(r1.find((e) => e.no === 2)?.beat === '发展', 'outline：未提及章节内容不变')
  // beatFull 保留：编辑路径不带 beatFull 字段 → 从 prev 回退
  const r2 = normalizeOutline([{ id: 'a', no: 1, title: '第一章', beat: 'x' }], { prev })
  ok(r2.find((e) => e.no === 1)?.beat === 'x', 'outline：字段更新')
  // 非 preserve：允许删除
  const r3 = normalizeOutline([{ id: 'b', no: 2, title: '第二章', beat: '发展' }], { prev })
  ok(r3.length === 1 && r3[0].no === 2, 'outline 非 preserve：可删除')
  // 排序：按章号
  const r4 = normalizeOutline([
    { no: 3, title: '三', beat: 'c' },
    { no: 1, title: '一', beat: 'a' }
  ])
  ok(r4[0].no === 1, 'outline：按章号排序')
}

// ============ normalizeDict ============
{
  const prev = [{ id: 'd1', term: '青云剑诀', category: '功法技能', aliases: [], desc: '', firstChapter: '' }]
  const r = normalizeDict(
    [
      { term: '青云剑诀', category: '功法技能', desc: '修订说明' },
      { term: '林栖', category: '人物', desc: '女主' }
    ],
    { preserve: true, prev }
  )
  ok(r.length === 2, 'dict preserve：旧词条保留')
  ok(r.find((e) => e.term === '青云剑诀')?.desc === '修订说明', 'dict：同词条按 term 认领更新')
  ok(r.find((e) => e.term === '林栖')?.category === '人物', 'dict：新词条入库')
}

// ============ normalizePower ============
{
  // 字符串境界名自动转对象（此前静默丢弃）
  const r = normalizePower({ realms: ['炼气', '筑基', '金丹'] as unknown[], rules: '', chars: [] })
  ok(r.realms.length === 3 && typeof r.realms[0] === 'object' && r.realms[0].name === '炼气', 'power：字符串境界名转条目')
  const r2 = normalizePower({ realms: [], rules: '', chars: [{ name: '林栖', realm: '筑基' }] }, { preserve: true, prev: r })
  ok(r2.realms.length === 3, 'power preserve：旧阶梯保留')
}

// ============ normalizeTracking ============
{
  const r = normalizeTracking([
    { name: '林栖', status: '受伤', lastChapter: '第3章', location: '北境', note: '' }
  ])
  ok(r.length === 1 && r[0].status === '受伤', 'tracking：基本条目')
  // 非法状态收敛为默认
  const r2 = normalizeTracking([{ name: '阿九', status: '诈尸' as unknown as '健康' }])
  ok(['健康', '受伤', '闭关', '离场', '死亡'].includes(r2[0]?.status), 'tracking：非法状态收敛')
}

// ============ splitCharacterText / 迁移 ============
{
  const card = '# 林栖\n女主。\n\n## 墨白（反派）\n魔修。\n\n# 顾云舟\n主角。'
  const sections = splitCharacterText(card)
  ok(sections.length === 3, 'split：三张卡')
  ok(sections[0].name === '林栖' && sections[1].name === '墨白（反派）', 'split：名字清洗保留括号')
  ok(sections.every((s) => s.content.trim()), 'split：内容非空')
  ok(splitCharacterText('没有标题的纯文本').length === 0, 'split：无标题返回空')

  // 迁移：临时书目录里放旧整包 → 拆分 + .bak + 幂等
  const root = mkdtempSync(join(tmpdir(), 'dawo-test-'))
  setLibraryRoot(root)
  const book = '测试书'
  mkdirSync(join(root, book, '角色'), { recursive: true })
  writeFileSync(join(root, book, '角色', '角色设定.md'), card)
  const n = splitLegacyCharacters(book)
  const files = readdirSync(join(root, book, '角色'))
  ok(n === 3, 'migrate：拆出 3 张')
  ok(files.includes('林栖.md') && files.includes('顾云舟.md'), 'migrate：单卡落盘')
  ok(files.some((f) => f.startsWith('角色设定.md.') && f.includes('bak')), 'migrate：原文件留 .bak')
  ok(splitLegacyCharacters(book) === 0, 'migrate：幂等重跑 0')
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n测试结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
