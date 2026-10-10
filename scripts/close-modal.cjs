// 关闭遗留弹窗：发 Esc 键（InkModal 监听 window keydown Escape）
(async () => {
  const res = await fetch('http://127.0.0.1:9222/json')
  const page = (await res.json()).find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.onopen = r)
  let seq = 0
  const send = (m, p = {}) => new Promise((res2, rej) => {
    const id = ++seq
    ws.addEventListener('message', function h(ev) {
      const d = JSON.parse(ev.data)
      if (d.id === id) { ws.removeEventListener('message', h); d.error ? rej(new Error(JSON.stringify(d.error))) : res2(d.result) }
    })
    ws.send(JSON.stringify({ id, method: m, params: p }))
  })
  await send('Runtime.enable')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await new Promise((r) => setTimeout(r, 400))
  const check = await send('Runtime.evaluate', { expression: `(() => [...document.querySelectorAll('*')].some(e => e.offsetParent !== null && e.textContent.trim() === 'AI 创建智能体' && e.tagName === 'SPAN'))()`, returnByValue: true })
  console.log('modal still open:', check.result.value)
  if (check.result.value) {
    const r2 = await send('Runtime.evaluate', { expression: `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent!==null&&b.textContent.trim()==='✕'); if(b){b.click();return 'clicked ✕'} return 'no ✕' })()`, returnByValue: true })
    console.log(r2.result.value)
  }
  ws.close()
})().catch((e) => { console.error(e.message); process.exit(1) })
