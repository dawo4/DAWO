import { reactive } from 'vue'

/**
 * 去AI味面板共享状态：组件卸载重挂（切页面）不丢结果。
 * 改写/诊断进行中切页，流式输出会继续写回这里，回来即可看到完整结果。
 */
export const deaiState = reactive({
  genre: 'fiction' as 'fiction' | 'article',
  characterCard: '',
  characterBook: '', // 角色卡所属书名，换书后需重读
  mode: 'idle' as 'idle' | 'diagnose' | 'rewrite' | 'score',
  report: '',
  rewritten: '',
  level: 'L2',
  running: false,
  error: '',
  scores: null as Record<string, number> | null,
  summary: '',
  aborter: null as { abort: () => void } | null, // 当前在途任务的中止句柄，供停止按钮用
  runSeq: 0 // 任务代次：新任务递增，旧任务的收尾逻辑看到代次不匹配就不再动共享状态
})
