// 测试执行器：esbuild 把 tests/*.test.ts 打包成可独立运行的 cjs（electron 以桩替换），逐个执行
// 用法：npm run test（或 node scripts/run-tests.cjs [指定测试文件名过滤]）
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const esbuildBin = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')
const testsDir = path.join(root, 'tests')
const filter = process.argv[2] || ''

const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts') && f.includes(filter))
if (!files.length) {
  console.error('没有找到测试文件')
  process.exit(1)
}

let failed = 0
for (const f of files) {
  const src = path.join(testsDir, f)
  const out = path.join(root, 'out', `test-${f.replace(/\.ts$/, '')}.cjs`)
  console.log(`\n▶ ${f}`)
  try {
    // 经 node 调 esbuild 的 js 入口（Windows 下 execFileSync 直接跑 .cmd 会被拦）
    execFileSync(process.execPath, [esbuildBin, src, '--bundle', '--platform=node', '--format=cjs', '--alias:electron=./tests/electron-stub.ts', `--outfile=${out}`], { stdio: 'pipe' })
    execFileSync(process.execPath, [out], { stdio: 'inherit' })
  } catch {
    failed++
  } finally {
    try {
      fs.rmSync(out, { force: true })
    } catch {
      /* 清理失败无碍 */
    }
  }
}

console.log(failed ? `\n✗ ${failed} 个测试文件失败` : '\n✓ 全部测试通过')
process.exit(failed ? 1 : 0)
