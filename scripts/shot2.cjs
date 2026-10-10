// 补充截图：资源库条目 + 自定义智能体编辑弹窗（真实走一次 AI 起草）
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, '..', 'resources', 'marketing-shots')
fs.mkdirSync(OUT, { recursive: true })

async function getTarget() {
  const res = await fetch('http://127.0.0.1:9222/json')
  const list = await res.json()
  return list.find((t) => t.type === 'page')
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('ws error'))
  })
}
let seq = 0
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMsg)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evalJs(ws, expression) {
  const r = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result.value
}
async function shot(ws, name) {
  await evalJs(ws, `new Promise(r => { let n = 0; const f = () => { if (++n >= 3) return r(); requestAnimationFrame(f) }; requestAnimationFrame(f); setTimeout(r, 1500) })`)
  await sleep(500)
  const r = await send(ws, 'Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log('saved', name)
}
function clickText(label) {
  return `(function(){
    const els = [...document.querySelectorAll('button, .nav-item, [class*=nav], div, span, a')];
    const el = els.find(e => e.textContent.trim() === '${label}' && e.offsetParent !== null);
    if (!el) return 'not found: ${label}';
    el.click();
    return 'clicked ${label}';
  })()`
}

async function main() {
  const target = await getTarget()
  const ws = await connect(target.webSocketDebuggerUrl)
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  try { await send(ws, 'Page.bringToFront') } catch (e) {}
  await sleep(400)

  // ===== 资源库 =====
  await evalJs(ws, clickText('资源库'))
  await sleep(600)
  await shot(ws, '13-资源库-技能库')

  // 打开技能条目：黄金三章
  await evalJs(ws, clickText('黄金三章'))
  await shot(ws, '14-技能库-黄金三章')
  await evalJs(ws, clickText('三幕式骨架'))
  await shot(ws, '15-技能库-三幕式骨架')

  // 素材库
  await evalJs(ws, clickText('素材库'))
  await sleep(500)
  await shot(ws, '16-素材库-桥段库')
  await evalJs(ws, clickText('退婚打脸'))
  await shot(ws, '17-素材库-退婚打脸')

  // ===== 自定义智能体弹窗 =====
  await evalJs(ws, clickText('智能体库'))
  await sleep(600)
  await evalJs(ws, clickText('AI 创建智能体'))
  await sleep(500)
  await shot(ws, '18-创建智能体-描述')

  // 填描述并点 AI 起草（Vue v-model 需原生 setter + input 事件）
  const fill = `(async function(){
    const ta = [...document.querySelectorAll('textarea')].find(t => t.offsetParent !== null);
    if (!ta) return 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '帮我做一个考据智能体，专门检查清代的官职、服饰、饮食、称谓在我的小说里是否穿帮，发现不符就给出符合史实的替换建议。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('AI 起草') && b.offsetParent !== null);
    if (!btn) return 'no draft button';
    btn.click();
    return 'drafting';
  })()`
  console.log('fill:', await evalJs(ws, fill))

  // 轮询等待起草完成（step2 表单出现「结构化板块」字样），最多 120s
  let ok = false
  for (let i = 0; i < 40; i++) {
    await sleep(3000)
    const st = await evalJs(ws, `(() => {
      const done = [...document.querySelectorAll('*')].some(e => e.offsetParent !== null && e.textContent.trim() === '结构化板块');
      return done ? 'step2' : 'waiting';
    })()`)
    if (st === 'step2') { ok = true; break }
  }
  console.log('draft done:', ok)
  await sleep(500)
  await shot(ws, '19-创建智能体-权限表单')
  // 滚到表单下半部分（结构化板块色块区域）
  await evalJs(ws, `(() => { const el = [...document.querySelectorAll('*')].find(e => e.offsetParent !== null && e.textContent.trim() === '结构化板块'); if (el) el.scrollIntoView({ block: 'center' }); return true })()`)
  await sleep(400)
  await shot(ws, '20-创建智能体-板块色块')

  // 关闭弹窗（Esc）
  await evalJs(ws, `document.activeElement && document.activeElement.blur(); true`)
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  console.log('done')
  ws.close()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
