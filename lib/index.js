// =====================================================================
// Cindy 任务秘书 — Host 半边（DSH 正式插件格式）
// 由 taskman 动态插件固化而来：
//  - RPC：TypertRemoteService('cindy') + invoke(method, args)，
//    网关以严格描述符（透传 codec）自动暴露 cindy/invoke 端点；
//  - 工具：ctx.tools.register(defineTool(...))，9 个 cindy_* 模型工具；
//  - 事件：tools/result、agent/status 会话活动监控；
//  - 数据：<根目录>/.taskman/{config,products,templates,tasks}.json
//          + journal.jsonl + reports/*.md（日报/周报）
// =====================================================================
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'cindy'
// fs / workspaceRegistry / sandboxPolicy 是硬依赖：声明在 inject 里，加载器会等
// 服务出现后再激活本行，避免启动时序导致 ctx.get 拿到 undefined 或写入策略缺失
// （sessionQuery/shell 仍按可选处理）。
export const inject = ['timer', 'tools', 'typert', 'fs', 'workspaceRegistry', 'sandboxPolicy']

/** 透传 codec：网关边界校验走“接受一切”的 parse，业务层自行保证 JSON 安全。 */
const passthrough = (typeSymbol) => ({
  mode: 'strict',
  typeSymbol,
  schema: { parse: (v) => v },
})

export function apply(ctx) {
  const fs = ctx.get('fs')
  const wsReg = ctx.get('workspaceRegistry')
  const sq = ctx.get('sessionQuery')
  const shellSvc = ctx.get('shell')
  const sp = ctx.get('sandboxPolicy')
  if (fs === undefined || wsReg === undefined) {
    console.error('[cindy] 缺少 fs / workspaceRegistry 服务，插件无法工作')
    return
  }
  // 沙箱策略：插件是无会话上下文的受信任代码，默认策略会拒绝写入用户选定的
  // 总目录，因此显式解析 full-access 策略并在每次写入时传入；
  // 同时用 fs.contains 自我约束写入范围必须在总目录之内（防御性双保险）。
  const fullPolicy = sp !== undefined ? sp.resolve({ mode: 'danger-full-access' }) : undefined

  // ---------- 常量 ----------
  const STAGES = ['需求收集', '方案设计', '执行验证', '总结归档', '已关闭']
  const PRIORITIES = ['高', '中', '低']
  const DEFAULT_DAILY_TIME = '18:00'
  const DEFAULT_WEEKLY_DAY = 1

  // ---------- 状态 ----------
  let config = null
  let products = []
  let templates = []
  let tasks = []
  let journal = []
  let reports = []
  let sessionTaskMap = {}
  let chain = Promise.resolve()

  // ---------- 工具函数 ----------
  const pad = (n) => String(n).padStart(2, '0')
  const dateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const nowIso = () => new Date().toISOString()
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const sanitize = (n) => String(n || '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const weekdayName = ['日', '一', '二', '三', '四', '五', '六']
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  const pname = (id) => { const p = products.find((x) => x.id === id); return p ? p.name : '未知产品' }
  const findTask = (ref) => tasks.find((t) => t.id === ref) || tasks.find((t) => t.name === ref) || tasks.find((t) => t.name.indexOf(String(ref)) >= 0)
  const findProduct = (ref) => products.find((p) => p.id === ref) || products.find((p) => p.name === ref)
  const findTemplate = (ref) => templates.find((t) => t.id === ref) || templates.find((t) => t.name === ref)
  const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '')

  // 写操作互斥队列：串行化所有状态变更；单点卡死由超时兜底（30s 后自动恢复队列）。
  // 读操作（get-state/get-journal/task-sessions/read-report）不进队列，直接读内存快照。
  const withTimeout = (p, ms, msg) => new Promise((res, rej) => {
    let done = false
    const clear = ctx.timeout(() => { if (!done) { done = true; rej(new Error(msg)) } }, ms)
    p.then((v) => { if (!done) { done = true; clear(); res(v) } }, (e) => { if (!done) { done = true; clear(); rej(e) } })
  })
  const mutex = (fn, ms = 30000) => {
    const r = chain.then(() => withTimeout(Promise.resolve().then(fn), ms, '操作超时（30s）'))
    chain = r.then(() => undefined, () => undefined)
    return r
  }

  // ---------- 文件系统 ----------
  let rootTarget = null
  async function rt(path) { return await fs.readText(await fs.resolve(path)) }
  async function wt(path, content) {
    const target = await fs.resolve(path)
    if (rootTarget !== null && !fs.contains(rootTarget, target)) {
      throw new Error('拒绝写入总目录之外的路径：' + path)
    }
    return await fs.writeText(target, String(content), undefined, undefined, fullPolicy)
  }
  async function exists(path) {
    try { return (await fs.stat(await fs.resolve(path))) !== undefined } catch (e) { return false }
  }
  async function ensureDir(path) {
    if (await exists(path)) return true
    // 优先用 shell 建目录（干净，不在用户目录留下标记文件）；Windows cmd mkdir 支持嵌套路径。
    if (shellSvc !== undefined) {
      try {
        const display = fs.processPath ? fs.processPath(path) : String(path)
        const spec = shellSvc.resolve({ command: 'mkdir "' + String(display).replace(/"/g, '') + '"' })
        await shellSvc.run(spec)
        if (await exists(path)) return true
      } catch (e2) {
        console.error('[cindy] shell 建目录失败：' + path, e2)
      }
    }
    // 最后手段：写入标记文件（writeText 自动建父目录），仅在没有 shell 时使用
    try { await wt(path + '/.taskman-keep', ''); return await exists(path) } catch (e) {}
    return false
  }

  // ---------- 持久化（调用方需已持锁）----------
  async function saveConfigInner() {
    if (!config) return
    await ensureDir(config.root + '/.taskman')
    await wt(config.root + '/.taskman/config.json', JSON.stringify(config, null, 2))
  }
  async function saveTableInner(tab, data) {
    if (!config) return
    await ensureDir(config.root + '/.taskman')
    await wt(config.root + '/.taskman/' + tab + '.json', JSON.stringify(data, null, 2))
  }
  function appendJournalInner(entry) {
    const e = { id: uid('j'), t: nowIso(), l: dateStr(new Date()) }
    for (const k of Object.keys(entry || {})) e[k] = entry[k]
    journal.push(e)
    if (journal.length > 3000) journal = journal.slice(-3000)
    return wt(config.root + '/.taskman/journal.jsonl', journal.map((x) => JSON.stringify(x)).join('\n') + '\n')
  }
  const appendJournal = (entry) => mutex(() => appendJournalInner(entry))

  async function loadTablesInner() {
    const dir = config.root + '/.taskman/'
    const j = async (f) => { try { return JSON.parse(await rt(dir + f)) } catch (e) { return null } }
    const ps = await j('products.json')
    const tps = await j('templates.json')
    const tks = await j('tasks.json')
    products = Array.isArray(ps) ? ps : []
    templates = Array.isArray(tps) ? tps : []
    tasks = Array.isArray(tks) ? tks : []
    try {
      const raw = await rt(dir + 'journal.jsonl')
      journal = raw.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
    } catch (e) { journal = [] }
    try {
      const lst = await fs.listDir(await fs.resolve(dir + 'reports'))
      reports = []
      for (const en of lst) {
        const n = String(en && en.name !== undefined ? en.name : en)
        const m = n.match(/^(\d{4}-\d{2}-\d{2})\.(daily)\.md$/) || n.match(/^(\d{4}-W\d{2})\.(weekly)\.md$/)
        if (!m) continue
        reports.push({ id: n, kind: m[2], date: m[1] })
      }
      reports.sort((a, b) => (a.date < b.date ? 1 : -1))
    } catch (e) { reports = [] }
  }

  // ---------- 根目录 ----------
  async function setRootInner(rootPath) {
    const root = String(rootPath || '').trim().replace(/[\\/]+$/, '')
    if (!root) throw new Error('路径为空')
    if (!(await ensureDir(root))) throw new Error('目录不可写：' + root)
    rootTarget = await fs.resolve(root)
    const dir = root + '/.taskman'
    if (!(await ensureDir(dir))) throw new Error('无法创建管理目录 ' + dir)
    if (!(await ensureDir(dir + '/reports'))) throw new Error('无法创建报告目录')
    let existing = null
    try { existing = JSON.parse(await rt(dir + '/config.json')) } catch (e) {}
    config = {
      root,
      dailyTime: (existing && existing.dailyTime) || DEFAULT_DAILY_TIME,
      weeklyDay: (existing && existing.weeklyDay) || DEFAULT_WEEKLY_DAY,
      createdAt: (existing && existing.createdAt) || nowIso(),
    }
    await saveConfigInner()
    await loadTablesInner()
    if (templates.length === 0) {
      templates.push({
        id: uid('tpl'),
        name: '通用任务模板',
        items: [
          { path: 'script', desc: '存放脚本' },
          { path: 'data', desc: '存放数据' },
          { path: 'output', desc: '代码输出的文件' },
          { path: 'outcome', desc: '任务得到的成果、结论' },
          { path: 'reference', desc: '参考文档' },
          { path: 'project', desc: '项目简介、会议记录和进程' },
        ],
        files: [],
        note: '内置默认模板',
        builtin: true,
        createdAt: nowIso(),
      })
      await saveTableInner('templates', templates)
    }
    await appendJournalInner({ kind: 'system', taskId: null, source: 'system', text: 'Cindy 已启用，根目录：' + root })
    await refreshSessionMapInner()
    return { ok: true }
  }

  // ---------- 产品 ----------
  async function createProductInner(args) {
    const name = sanitize(args.name)
    if (!name) throw new Error('产品名不能为空')
    if (products.some((x) => x.name === name)) throw new Error('同名产品已存在')
    const item = { id: uid('p'), name, folder: name, note: String(args.note || ''), createdAt: nowIso() }
    await ensureDir(config.root + '/' + item.folder)
    try { await wt(config.root + '/' + item.folder + '/README.md', '# 产品：' + name + '\n\n' + (item.note || '产品工作目录。') + '\n') } catch (e) {}
    products.push(item)
    await saveTableInner('products', products)
    return { ok: true, product: clone(item) }
  }
  async function updateProductInner(args) {
    const p = products.find((x) => x.id === args.id)
    if (!p) throw new Error('产品不存在')
    if (args.name !== undefined) {
      const n = sanitize(args.name)
      if (!n) throw new Error('产品名不能为空')
      if (products.some((x) => x.id !== p.id && x.name === n)) throw new Error('同名产品已存在')
      p.name = n
    }
    if (args.note !== undefined) p.note = String(args.note || '')
    await saveTableInner('products', products)
    return { ok: true, product: clone(p) }
  }
  async function deleteProductInner(args) {
    const p = products.find((x) => x.id === args.id)
    if (!p) throw new Error('产品不存在')
    if (tasks.some((t) => t.productId === p.id)) throw new Error('该产品下仍有任务，无法删除')
    products = products.filter((x) => x.id !== p.id)
    await saveTableInner('products', products)
    return { ok: true }
  }

  // ---------- 模板 ----------
  async function createTemplateInner(args) {
    const name = sanitize(args.name)
    if (!name) throw new Error('模板名不能为空')
    const items = (args.items || []).filter((it) => it && it.path)
    if (items.length === 0) throw new Error('模板至少需要一个文件夹')
    const tpl = { id: uid('tpl'), name, items, files: [], note: String(args.note || ''), createdAt: nowIso() }
    templates.push(tpl)
    await saveTableInner('templates', templates)
    return { ok: true, template: clone(tpl) }
  }
  async function updateTemplateInner(args) {
    const t = templates.find((x) => x.id === args.id)
    if (!t) throw new Error('模板不存在')
    if (args.name !== undefined) {
      const n = sanitize(args.name)
      if (!n) throw new Error('模板名不能为空')
      t.name = n
    }
    if (args.items !== undefined) {
      const items = (args.items || []).filter((it) => it && it.path)
      if (items.length === 0) throw new Error('模板至少需要一个文件夹')
      t.items = items
    }
    if (args.note !== undefined) t.note = String(args.note || '')
    await saveTableInner('templates', templates)
    return { ok: true, template: clone(t) }
  }
  async function deleteTemplateInner(args) {
    const t = templates.find((x) => x.id === args.id)
    if (!t) throw new Error('模板不存在')
    if (t.builtin) throw new Error('内置模板不可删除')
    templates = templates.filter((x) => x.id !== args.id)
    await saveTableInner('templates', templates)
    return { ok: true }
  }

  // ---------- 任务 ----------
  async function createTaskInner(args) {
    const product = findProduct(args.productId)
    if (!product) throw new Error('请选择产品')
    const tpl = findTemplate(args.templateId) || templates[0]
    if (!tpl) throw new Error('请先创建模板')
    const taskName = sanitize(args.name)
    if (!taskName) throw new Error('任务名不能为空')
    const folder = config.root + '/' + product.folder + '/' + taskName
    if (tasks.some((t) => norm(t.folder) === norm(folder))) throw new Error('同名任务已存在')
    if (!(await ensureDir(folder))) throw new Error('无法创建任务目录：' + folder)
    const created = []
    for (const item of (tpl.items || [])) {
      const rel = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '')
      if (!rel) continue
      const sub = folder + '/' + rel
      if (await ensureDir(sub)) {
        created.push(rel)
        if (item.desc) {
          try { await wt(sub + '/README.md', '# ' + rel + '\n\n' + item.desc + '\n') } catch (e) {}
        }
      }
    }
    for (const f of (tpl.files || [])) {
      try {
        const rel = String(f.path || '').replace(/\\/g, '/').replace(/^\/+/, '')
        if (!rel) continue
        const fp = folder + '/' + rel
        const slash = fp.lastIndexOf('/')
        if (slash > 0) await ensureDir(fp.slice(0, slash))
        await wt(fp, String(f.content || ''))
      } catch (e) { console.error('[cindy] 初始文件写入失败：' + f.path, e) }
    }
    const sd = validDate(args.startDate) || dateStr(new Date())
    const dd = validDate(args.dueDate)
    const pri = PRIORITIES.indexOf(args.priority) >= 0 ? args.priority : '中'
    const meta = [
      '# 任务：' + taskName, '',
      '- 产品：' + product.name,
      '- 创建时间：' + nowIso(),
      '- 开始日期：' + sd,
      '- 截止日期：' + (dd || '未设定'),
      '- 优先级：' + pri,
      '- 当前阶段：' + STAGES[0], '',
      '本目录结构由模板「' + tpl.name + '」生成。',
    ].join('\n')
    await wt(folder + '/README.md', meta)
    let workspaceId = null
    try {
      const ws = await wsReg.create(folder, product.name + '/' + taskName)
      workspaceId = ws && ws.id ? String(ws.id) : null
    } catch (e) { console.error('[cindy] 注册工作区失败', e) }
    const task = {
      id: uid('t'), productId: product.id, templateId: tpl.id, name: taskName, folder,
      workspaceId, stage: STAGES[0], priority: pri,
      startDate: sd, dueDate: dd, note: String(args.note || ''), progress: 0,
      createdAt: nowIso(), updatedAt: nowIso(), closedAt: null,
    }
    tasks.push(task)
    await saveTableInner('tasks', tasks)
    await appendJournalInner({ kind: 'task-created', taskId: task.id, source: 'user', text: '创建任务「' + taskName + '」（产品：' + product.name + '，模板：' + tpl.name + '）' })
    await refreshSessionMapInner()
    return { ok: true, task: clone(task), createdDirs: created }
  }

  async function updateTaskInner(args) {
    const task = tasks.find((x) => x.id === args.id)
    if (!task) throw new Error('任务不存在')
    const patch = args.patch || {}
    const notes = []
    if (patch.stage !== undefined && patch.stage !== task.stage) {
      if (STAGES.indexOf(patch.stage) < 0) throw new Error('未知阶段')
      notes.push({ kind: 'stage', text: '阶段变更：' + task.stage + ' → ' + patch.stage })
      task.stage = patch.stage
      task.closedAt = patch.stage === STAGES[STAGES.length - 1] ? nowIso() : task.closedAt
    }
    if (patch.progress !== undefined) {
      const n = Math.max(0, Math.min(100, Math.round(Number(patch.progress) || 0)))
      if (n !== task.progress) {
        task.progress = n
        notes.push({ kind: 'progress', text: '进度更新为 ' + n + '%' })
      }
    }
    if (patch.priority !== undefined) {
      const v = String(patch.priority)
      if (PRIORITIES.indexOf(v) < 0) throw new Error('未知优先级')
      task.priority = v
    }
    if (patch.startDate !== undefined) {
      const v = validDate(patch.startDate)
      if (patch.startDate !== '' && !v) throw new Error('开始日期格式应为 YYYY-MM-DD')
      task.startDate = v || dateStr(new Date())
    }
    if (patch.dueDate !== undefined) {
      const v = validDate(patch.dueDate)
      if (patch.dueDate !== '' && !v) throw new Error('截止日期格式应为 YYYY-MM-DD')
      task.dueDate = v
    }
    if (patch.note !== undefined) task.note = String(patch.note || '')
    if (patch.name !== undefined) {
      const n = sanitize(patch.name)
      if (n) {
        task.name = n
        notes.push({ kind: 'note', text: '任务重命名为「' + n + '」' })
      }
    }
    task.updatedAt = nowIso()
    await saveTableInner('tasks', tasks)
    for (const n of notes) await appendJournalInner({ taskId: task.id, source: 'user', kind: n.kind, text: n.text })
    return { ok: true, task: clone(task) }
  }

  async function deleteTaskInner(args) {
    const task = tasks.find((x) => x.id === args.id)
    if (!task) throw new Error('任务不存在')
    tasks = tasks.filter((x) => x.id !== args.id)
    await saveTableInner('tasks', tasks)
    await refreshSessionMapInner()
    await appendJournalInner({ kind: 'system', taskId: null, source: 'system', text: '任务「' + task.name + '」已从秘书处移除（目录与工作区保留）' })
    return { ok: true }
  }

  async function addLogInner(args) {
    const task = tasks.find((x) => x.id === args.taskId)
    if (!task) throw new Error('任务不存在')
    const text = String(args.text || '').trim()
    if (!text) throw new Error('内容为空')
    await appendJournalInner({ kind: 'note', taskId: task.id, source: 'user', text })
    return { ok: true }
  }

  // ---------- 日报 / 周报 ----------
  function isoWeekOf(d) {
    // 与 weekRangeOf 一致使用本地时区，避免跨年/周界差一天
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const day = x.getDay() || 7
    x.setDate(x.getDate() + 4 - day)
    const ys = new Date(x.getFullYear(), 0, 1)
    return { year: x.getFullYear(), week: Math.ceil((((x - ys) / 86400000) + 1) / 7) }
  }
  function weekRangeOf(key) {
    const m = String(key).match(/^(\d{4})-W(\d{2})$/)
    if (!m) throw new Error('无效的周标识')
    const year = parseInt(m[1], 10)
    const week = parseInt(m[2], 10)
    const jan4 = new Date(year, 0, 4)
    const mon = new Date(jan4)
    mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return { from: dateStr(mon), to: dateStr(sun), mon, sun }
  }

  async function generateReportInner(kind, key) {
    if (!config) throw new Error('尚未设置根目录')
    let from, to
    if (kind === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('日期格式错误')
      from = key; to = key
    } else {
      const r = weekRangeOf(key)
      from = r.from; to = r.to
    }
    const entries = journal.filter((e) => e.l && e.l >= from && e.l <= to)
    const touched = {}
    for (const e of entries) {
      if (!e.taskId) continue
      touched[e.taskId] = touched[e.taskId] || { entries: [], sessions: {} }
      const t = touched[e.taskId]
      t.entries.push(e)
      if (e.sessionId) t.sessions[e.sessionId] = true
    }
    const byTask = Object.keys(touched).map((id) => {
      const task = tasks.find((x) => x.id === id)
      const t = touched[id]
      const stageMoves = t.entries.filter((e) => e.kind === 'stage')
      return {
        task, count: t.entries.length, sessionCount: Object.keys(t.sessions).length,
        fileOps: t.entries.filter((e) => e.kind === 'session-activity').length,
        notes: t.entries.filter((e) => e.kind === 'note').length,
        stageMoves, latest: t.entries[t.entries.length - 1],
        entries: t.entries,
      }
    })
    const today = dateStr(new Date())
    const open = tasks.filter((t) => t.stage !== STAGES[STAGES.length - 1])
    const dueToday = open.filter((t) => t.dueDate === today)
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today)
    const activeSessions = {}
    for (const e of entries) if (e.sessionId) activeSessions[e.sessionId] = true
    const fileOps = entries.filter((e) => e.kind === 'session-activity').length
    const stageMoved = byTask.filter((x) => x.stageMoves.length > 0)

    const L = []
    if (kind === 'daily') {
      const wd = weekdayName[new Date(key + 'T00:00:00').getDay()]
      L.push('# 📅 每日总结 ' + key + '（星期' + wd + '）')
      L.push('')
      L.push('## 今日概览')
      L.push('- 在管任务：' + tasks.length + '（进行中 ' + open.length + '）')
      L.push('- 今日到期：' + dueToday.length + (dueToday.length ? '（' + dueToday.map((t) => t.name).join('、') + '）' : ''))
      L.push('- 已逾期：' + overdue.length + (overdue.length ? '（' + overdue.map((t) => t.name + '，截止 ' + t.dueDate).join('、') + '）' : ''))
      L.push('- 活跃会话：' + Object.keys(activeSessions).length + ' 个；会话活动记录 ' + fileOps + ' 条')
      L.push('')
      if (byTask.length === 0) {
        L.push('今日暂无任务活动记录。')
      } else {
        L.push('## 今日进展')
        for (const b of byTask) {
          if (!b.task) continue
          L.push('### ' + b.task.name + '（' + pname(b.task.productId) + ' · ' + b.task.stage + ' · ' + b.task.progress + '%）')
          for (const e of b.entries.slice(-12)) {
            L.push('- [' + String(e.t || '').slice(11, 16) + '] ' + e.text)
          }
          L.push('')
        }
      }
      if (stageMoved.length) {
        L.push('## 阶段变更')
        for (const b of stageMoved) {
          const mv = b.stageMoves[b.stageMoves.length - 1]
          L.push('- ' + b.task.name + '：' + mv.text)
        }
        L.push('')
      }
      L.push('## 近期提醒')
      const soon = open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= dateStr(new Date(Date.now() + 2 * 86400000)))
      if (soon.length) for (const t of soon) L.push('- ' + t.name + ' 将于 ' + t.dueDate + ' 到期')
      if (overdue.length) for (const t of overdue) L.push('- ⚠️ ' + t.name + ' 已逾期（' + t.dueDate + '）')
      if (!soon.length && !overdue.length) L.push('- 无')
      L.push('')
    } else {
      const createdThisWeek = tasks.filter((t) => t.createdAt.slice(0, 10) >= from && t.createdAt.slice(0, 10) <= to)
      const closedThisWeek = byTask.filter((b) => b.task && b.task.closedAt && b.task.closedAt.slice(0, 10) >= from && b.task.closedAt.slice(0, 10) <= to)
      L.push('# 📊 周报 ' + key + '（' + from + ' ~ ' + to + '）')
      L.push('')
      L.push('## 本周概览')
      L.push('- 在管任务：' + tasks.length + '（进行中 ' + open.length + '）')
      L.push('- 本周新建任务：' + createdThisWeek.length + (createdThisWeek.length ? '（' + createdThisWeek.map((t) => t.name).join('、') + '）' : ''))
      L.push('- 本周完成/归档：' + closedThisWeek.length + (closedThisWeek.length ? '（' + closedThisWeek.map((b) => b.task.name).join('、') + '）' : ''))
      L.push('- 参与会话：' + Object.keys(activeSessions).length + ' 个；会话活动记录 ' + fileOps + ' 条')
      L.push('')
      if (byTask.length === 0) {
        L.push('本周暂无任务活动记录。')
        L.push('')
      } else {
        L.push('## 本周进展')
        for (const b of byTask) {
          if (!b.task) continue
          L.push('### ' + b.task.name + '（' + pname(b.task.productId) + ' · ' + b.task.stage + ' · ' + b.task.progress + '%）')
          L.push('- 活动记录：' + b.count + ' 条（会话 ' + b.sessionCount + ' 个，文件操作 ' + b.fileOps + ' 条）')
          if (b.stageMoves.length) L.push('- 阶段推进：' + b.stageMoves.map((e) => e.text).join('；'))
          if (b.latest) L.push('- 最新记录：' + b.latest.text)
          L.push('')
        }
      }
      L.push('## 风险与逾期')
      if (overdue.length) for (const t of overdue) L.push('- ⚠️ ' + t.name + ' 已逾期（截止 ' + t.dueDate + '）')
      else L.push('- 无逾期任务')
      L.push('')
      L.push('## 下周计划')
      const next7 = open.filter((t) => t.dueDate && t.dueDate > to && t.dueDate <= dateStr(new Date(new Date(to + 'T00:00:00').getTime() + 7 * 86400000)))
      const noDue = open.filter((t) => !t.dueDate)
      if (next7.length) for (const t of next7) L.push('- ' + t.name + ' 将于 ' + t.dueDate + ' 到期')
      if (noDue.length) L.push('- 未设截止时间：' + noDue.map((t) => t.name).join('、'))
      if (!next7.length && !noDue.length) L.push('- 暂无')
      L.push('')
    }
    L.push('---')
    L.push('*由 Cindy 自动生成*')
    const md = L.join('\n')
    const file = config.root + '/.taskman/reports/' + key + '.' + kind + '.md'
    await wt(file, md)
    if (!reports.some((r) => r.id === key + '.' + kind + '.md')) reports.unshift({ id: key + '.' + kind + '.md', kind, date: key })
    await appendJournalInner({ kind: kind === 'daily' ? 'daily-summary' : 'weekly-report', taskId: null, source: 'system', text: (kind === 'daily' ? '生成每日总结' : '生成周报') + '：' + key, meta: { file } })
    return { ok: true, id: key + '.' + kind + '.md', kind, date: key, file, content: md }
  }

  async function schedulerTickInner() {
    if (!config) return
    const now = new Date()
    const parts = String(config.dailyTime || DEFAULT_DAILY_TIME).split(':')
    const h = parseInt(parts[0], 10) || 0
    const m = parseInt(parts[1], 10) || 0
    if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return
    const today = dateStr(now)
    if (!reports.some((r) => r.kind === 'daily' && r.date === today)) {
      try { await generateReportInner('daily', today) } catch (e) { console.error('[cindy] 日报生成失败', e) }
    }
    const dow = now.getDay() === 0 ? 7 : now.getDay()
    const wd = Number(config.weeklyDay) || 1
    if (dow >= wd) {
      const wk = isoWeekOf(now)
      const wkey = wk.year + '-W' + pad(wk.week)
      if (!reports.some((r) => r.kind === 'weekly' && r.date === wkey)) {
        try { await generateReportInner('weekly', wkey) } catch (e) { console.error('[cindy] 周报生成失败', e) }
      }
    }
  }
  const schedulerTick = () => mutex(() => schedulerTickInner())

  // ---------- 会话 → 任务 映射与活动监控 ----------
  async function refreshSessionMapInner() {
    if (!config) return
    try {
      const wsList = wsReg.list() || []
      const byPath = {}
      for (const w of wsList) {
        try {
          const wp = norm(String(w.path || ''))
          if (wp) byPath[wp] = String(w.id)
        } catch (e) {}
      }
      const map = {}
      let dirty = false
      for (const task of tasks) {
        // 优先按路径匹配当前注册表（权威），再退回存储的 workspaceId（可能是旧设备的过期 id）
        let wid = byPath[norm(task.folder)] || task.workspaceId
        if (!wid || !wsReg.get(wid)) {
          // 换设备/注册表丢失：按路径找不到工作区时自动补注册（幂等，失败静默，下次轮询重试）
          try {
            const p = findProduct(task.productId)
            const created = await wsReg.create(task.folder, (p ? p.name + '/' : '') + task.name)
            wid = created && created.id ? String(created.id) : null
            if (wid && task.workspaceId !== wid) { task.workspaceId = wid; dirty = true }
          } catch (e) {
            wid = null
          }
        } else if (task.workspaceId !== wid) {
          task.workspaceId = wid
          dirty = true
        }
        if (!wid) continue
        const w = wsReg.get(wid)
        if (!w) continue
        let ids = []
        try { ids = await Promise.resolve(w.sessionIds) } catch (e) {}
        if (!Array.isArray(ids)) continue
        for (const sid of ids) map[String(sid)] = task.id
      }
      sessionTaskMap = map
      if (dirty) await saveTableInner('tasks', tasks)
    } catch (e) { console.error('[cindy] 会话映射刷新失败', e) }
  }
  const refreshSessionMap = () => mutex(() => refreshSessionMapInner())

  const throttleMap = new Map()
  function throttled(key, ms) {
    const now = Date.now()
    const last = throttleMap.get(key) || 0
    if (now - last < ms) return true
    throttleMap.set(key, now)
    if (throttleMap.size > 5000) throttleMap.clear()
    return false
  }

  // 监控诊断：同类错误最多记 5 条，避免刷屏；出错有迹可查。
  const DIAG_MAX = 5
  let diagCount = 0
  function diagError(tag, e) {
    if (diagCount >= DIAG_MAX) return
    diagCount++
    console.error('[cindy] 监控异常 ' + tag + '：' + String((e && e.message) || e))
  }

  function onToolResult(exec, result) {
    if (!config || !exec) return
    Promise.resolve().then(async () => {
      try {
        let sid = null
        try { sid = exec.agent && (exec.agent.id || (exec.agent.session && exec.agent.session.id)) } catch (e) {}
        if (!sid) return
        const taskId = sessionTaskMap[String(sid)]
        if (!taskId) return
        const task = tasks.find((t) => t.id === taskId)
        if (!task) return
        const toolName = String(exec.name || '')
        const isWatched = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'pwsh', 'todo_write'].indexOf(toolName) >= 0
        if (!isWatched) return
        const input = exec.input || {}
        let filePath = null
        try { filePath = input.file_path || input.path || input.filePath || input.target || input.directory || null } catch (e) {}
        let text = null
        let metaKey = null
        let fileOp = false
        if (filePath) {
          let under = false
          let rel = null
          try {
            const a = await fs.resolve(task.folder)
            const b = await fs.resolve(String(filePath))
            under = fs.contains(a, b)
            if (under) rel = fs.processPath(b).slice(fs.processPath(a).length).replace(/^[\\/]+/, '')
          } catch (e) {
            under = norm(String(filePath)).startsWith(norm(task.folder))
            if (under) rel = String(filePath)
          }
          if (!under) return
          metaKey = String(rel || '').split('/')[0]
          fileOp = true
          const failed = result && result.error ? true : false
          text = (failed ? '会话操作失败 ' : '会话操作 ') + toolName + '：' + (rel || String(filePath))
        } else if (toolName === 'bash' || toolName === 'pwsh') {
          text = '会话执行了命令（' + toolName + '）'
          metaKey = 'shell'
        } else if (toolName === 'todo_write') {
          let n = 0
          try { n = (input.todos && input.todos.length) || 0 } catch (e) {}
          if (!n) return
          text = '会话更新了任务清单（' + n + ' 项）'
          metaKey = 'todo'
        } else {
          return
        }
        const key = taskId + '|' + sid + '|' + toolName + '|' + (metaKey || '')
        if (throttled(key, 10 * 60 * 1000)) return
        await appendJournal({ kind: 'session-activity', taskId, source: 'session', sessionId: String(sid), text, meta: { tool: toolName, fileOp } })
      } catch (e) { diagError('tools/result', e) }
    })
  }

  function onAgentStatus(payload) {
    if (!config || !payload) return
    try {
      let sid = null
      try { sid = payload.agent && (payload.agent.id || (payload.agent.session && payload.agent.session.id)) } catch (e) {}
      if (!sid || !payload.status) return
      const taskId = sessionTaskMap[String(sid)]
      if (!taskId) return
      const status = String(payload.status)
      if (status !== 'running' && status !== 'idle') return
      const key = taskId + '|' + sid + '|' + status
      if (throttled(key, 30 * 60 * 1000)) return
      appendJournal({ kind: 'session-activity', taskId, source: 'session', sessionId: String(sid), text: status === 'running' ? '会话开始新一轮工作' : '会话本轮工作结束' }).catch(() => {})
    } catch (e) { diagError('agent/status', e) }
  }

  // ---------- 统计与快照 ----------
  function computeStats() {
    const today = dateStr(new Date())
    const byStage = {}
    STAGES.forEach((s) => { byStage[s] = 0 })
    let dueToday = 0
    let overdue = 0
    let active = 0
    for (const t of tasks) {
      byStage[t.stage] = (byStage[t.stage] || 0) + 1
      if (t.stage !== STAGES[STAGES.length - 1]) {
        active++
        if (t.dueDate) {
          if (t.dueDate === today) dueToday++
          else if (t.dueDate < today) overdue++
        }
      }
    }
    return { total: tasks.length, byStage, dueToday, overdue, active, sessionLinks: Object.keys(sessionTaskMap).length }
  }

  async function getStateInner() {
    if (!config) return { ok: true, configured: false, state: null }
    return {
      ok: true,
      configured: true,
      state: {
        config: { root: config.root, dailyTime: config.dailyTime, weeklyDay: config.weeklyDay, stages: STAGES.slice() },
        products: clone(products),
        templates: clone(templates),
        tasks: clone(tasks),
        reports: clone(reports),
        stats: computeStats(),
        journalTail: journal.slice(-150).map((e) => clone(e)),
        sessionLinks: Object.keys(sessionTaskMap).length,
      },
    }
  }

  async function taskSessionsInner() {
    const out = []
    for (const task of tasks) {
      const wid = task.workspaceId
      if (!wid) continue
      const w = wsReg.get(wid)
      if (!w) continue
      let ids = []
      try { ids = await Promise.resolve(w.sessionIds) } catch (e) {}
      if (!Array.isArray(ids) || ids.length === 0) continue
      const titleById = {}
      if (sq !== undefined) {
        try {
          const obs = await sq.readTitleSnapshots(ids.map(String))
          for (const ob of (obs || [])) {
            try {
              const sid = ob && (ob.sessionId || (ob.header && ob.header.id))
              let title = null
              try { title = ob && (typeof ob.title === 'string' ? ob.title : (ob.snapshot && typeof ob.snapshot.title === 'string' ? ob.snapshot.title : null)) } catch (e) {}
              if (sid) titleById[String(sid)] = title || ''
            } catch (e) {}
          }
        } catch (e) {}
      }
      out.push({ taskId: task.id, workspaceId: wid, sessions: ids.map((sid) => ({ id: String(sid), title: titleById[String(sid)] || '' })) })
    }
    return { ok: true, list: out }
  }

  // ---------- RPC ----------
  const methods = {
    'get-state': () => getStateInner(),
    'set-root': (a) => setRootInner(a && a.path),
    'set-config': async (a) => {
      if (!config) throw new Error('尚未设置根目录')
      if (a.dailyTime !== undefined && /^\d{1,2}:\d{2}$/.test(String(a.dailyTime))) config.dailyTime = String(a.dailyTime)
      if (a.weeklyDay !== undefined) {
        const w = Number(a.weeklyDay)
        if (w >= 1 && w <= 7) config.weeklyDay = w
      }
      await saveConfigInner()
      return { ok: true }
    },
    'create-product': (a) => createProductInner(a),
    'update-product': (a) => updateProductInner(a),
    'delete-product': (a) => deleteProductInner(a),
    'create-template': (a) => createTemplateInner(a),
    'update-template': (a) => updateTemplateInner(a),
    'delete-template': (a) => deleteTemplateInner(a),
    'create-task': (a) => createTaskInner(a),
    'update-task': (a) => updateTaskInner(a),
    'delete-task': (a) => deleteTaskInner(a),
    'add-log': (a) => addLogInner(a),
    'get-journal': async (a) => {
      let list = journal
      if (a.taskId) list = list.filter((e) => e.taskId === a.taskId)
      if (a.kind) list = list.filter((e) => e.kind === a.kind)
      if (a.since) list = list.filter((e) => e.l >= a.since)
      const limit = Math.min(Number(a.limit) || 200, 1000)
      return { ok: true, entries: list.slice(-limit).reverse().map((e) => clone(e)) }
    },
    'generate-report': async (a) => {
      const kind = a.kind === 'weekly' ? 'weekly' : 'daily'
      const now = new Date()
      let key
      if (kind === 'daily') {
        key = validDate(a.date) || dateStr(now)
      } else {
        if (a.date && /^\d{4}-W\d{2}$/.test(a.date)) key = a.date
        else { const wk = isoWeekOf(now); key = wk.year + '-W' + pad(wk.week) }
      }
      return await generateReportInner(kind, key)
    },
    'read-report': async (a) => {
      if (!config) throw new Error('尚未设置根目录')
      const id = String(a.id || '')
      if (!/^[\w.-]+\.(daily|weekly)\.md$/.test(id)) throw new Error('非法报告名')
      const content = await rt(config.root + '/.taskman/reports/' + id)
      return { ok: true, id, content }
    },
    'task-sessions': () => taskSessionsInner(),
  }

  /** 读方法集合：不进入写互斥队列，直接读内存快照（读写分离，防止互斥毒化拖垮读取）。 */
  const READ_METHODS = new Set(['get-state', 'get-journal', 'read-report', 'task-sessions'])

  /** Cindy 服务：单一 invoke 端点承载全部 Client→Host RPC。 */
  class CindyService extends TypertRemoteService {
    constructor(c) {
      super(c, 'cindy')
    }
    invoke(method, args) {
      // 边界校验：方法白名单 + args 必须是普通对象（JSON 直连通道同样生效）
      const fn = methods[method]
      if (typeof fn !== 'function') return Promise.resolve({ ok: false, error: '未知方法：' + String(method) })
      const clean = (args !== null && typeof args === 'object' && !Array.isArray(args)) ? args : {}
      // 读操作不进互斥队列（直接读内存快照），写操作串行化 —— 互斥毒化不再拖垮读取
      const run = () => Promise.resolve().then(() => fn(clean))
      const task = READ_METHODS.has(method) ? run() : mutex(run)
      return task.catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
    }
  }
  const cindy = new CindyService(ctx)
  ctx.typert.register({
    package: '@cindy/taskman',
    face: 'host',
    model: { services: [], events: [], objects: [] },
    schemas: [],
    invocations: [
      {
        id: '@cindy/taskman#cindy/invoke',
        service: 'cindy',
        namespace: 'cindy',
        method: 'invoke',
        invocation: { kind: 'direct' },
        parameters: [
          { name: 'method', wire: 'method', source: 'json', codec: passthrough('@cindy/taskman/types#Method') },
          { name: 'args', wire: 'args', source: 'json', codec: passthrough('@cindy/taskman/types#JsonValue') },
        ],
        result: passthrough('@cindy/taskman/types#JsonValue'),
      },
    ],
  })

  // ---------- 模型工具（agent 也可以直接找 Cindy 当秘书用）----------
  function tool(def) {
    try {
      ctx.tools.register(defineTool(def))
    } catch (e) {
      console.error('[cindy] 工具注册失败：' + def.name, e)
    }
  }
  const out = { schema: { type: 'string' }, render: (args, value) => [{ type: 'text', text: String(value) }] }
  const run = (fn) => async (args) => {
    try {
      const r = await mutex(() => fn(args || {}))
      return typeof r === 'string' ? r : JSON.stringify(r, null, 2)
    } catch (e) {
      return '[Cindy] 失败：' + String((e && e.message) || e)
    }
  }

  tool({
    name: 'cindy_overview',
    description: '查看任务秘书 Cindy 的全局概览：根目录、任务数量与阶段分布、今日到期、逾期任务、最近报告。',
    parameters: {},
    output: out,
    execute: run(async () => {
      if (!config) return 'Cindy 尚未设置根目录。请在「Cindy」面板的“设置”页选择总目录，或用 cindy_set_root 工具设置。'
      const s = computeStats()
      const today = dateStr(new Date())
      const due = tasks.filter((t) => t.dueDate === today && t.stage !== STAGES[STAGES.length - 1]).map((t) => t.name + '（' + pname(t.productId) + '）')
      const over = tasks.filter((t) => t.dueDate && t.dueDate < today && t.stage !== STAGES[STAGES.length - 1]).map((t) => t.name + '（' + pname(t.productId) + '，截止 ' + t.dueDate + '）')
      const lines = ['根目录：' + config.root, '任务总数：' + s.total + '（进行中 ' + s.active + '）']
      lines.push('阶段分布：' + STAGES.map((st) => st + ' ' + (s.byStage[st] || 0)).join('；'))
      lines.push('今日到期：' + (due.length ? due.join('、') : '无'))
      lines.push('已逾期：' + (over.length ? over.join('、') : '无'))
      lines.push('已建立会话关联的任务会话数：' + s.sessionLinks)
      const rep = reports.slice(0, 3).map((r) => r.id).join('、')
      lines.push('最近报告：' + (rep || '无'))
      return lines.join('\n')
    }),
  })

  tool({
    name: 'cindy_set_root',
    description: '设置任务秘书 Cindy 的总目录（所有产品、任务与管理数据都存放在该目录下）。',
    parameters: { path: { type: 'string', description: '总目录的绝对路径', required: true } },
    output: out,
    execute: run(async (args) => {
      await setRootInner(args.path)
      return '已启用 Cindy，根目录：' + config.root + '。产品 ' + products.length + ' 个，任务 ' + tasks.length + ' 个，模板 ' + templates.length + ' 个。'
    }),
  })

  tool({
    name: 'cindy_create_task',
    description: '创建任务：在产品下按模板生成任务文件夹结构，并注册为 harness 工作区（任务文件夹即工作区）。',
    parameters: {
      product: { type: 'string', description: '产品 ID 或产品名', required: true },
      name: { type: 'string', description: '任务名（同时用作文件夹名），如 性能比测', required: true },
      template: { type: 'string', description: '模板 ID 或模板名，缺省用第一个模板' },
      start_date: { type: 'string', description: '开始日期 YYYY-MM-DD，缺省今天' },
      due_date: { type: 'string', description: '截止日期 YYYY-MM-DD' },
      priority: { type: 'string', description: '优先级：高/中/低，缺省中' },
      note: { type: 'string', description: '备注' },
    },
    output: out,
    execute: run(async (args) => {
      const product = findProduct(args.product)
      if (!product) throw new Error('产品不存在：' + args.product + '（可用 cindy_tasks 查看，或先在面板创建产品）')
      const r = await createTaskInner({
        productId: product.id, name: args.name, templateId: args.template,
        startDate: args.start_date, dueDate: args.due_date, priority: args.priority, note: args.note,
      })
      return '任务「' + r.task.name + '」已创建。\n目录：' + r.task.folder + '\n工作区 ID：' + (r.task.workspaceId || '未注册') + '\n阶段：' + r.task.stage + '，优先级：' + r.task.priority + '，截止：' + (r.task.dueDate || '未设定')
    }),
  })

  tool({
    name: 'cindy_progress',
    description: '更新任务进度：按 ID 或名称匹配任务，追加一条进展记录和/或更新进度百分比。',
    parameters: {
      task: { type: 'string', description: '任务 ID 或任务名（支持模糊匹配）', required: true },
      text: { type: 'string', description: '进展说明' },
      progress: { type: 'number', description: '进度 0-100' },
    },
    output: out,
    execute: run(async (args) => {
      const task = findTask(args.task)
      if (!task) throw new Error('任务不存在：' + args.task)
      const done = []
      if (args.progress !== undefined) {
        await updateTaskInner({ id: task.id, patch: { progress: args.progress } })
        done.push('进度 ' + args.progress + '%')
      }
      if (args.text !== undefined && String(args.text).trim()) {
        await addLogInner({ taskId: task.id, text: args.text })
        done.push('已记录进展')
      }
      if (done.length === 0) throw new Error('请提供 text 或 progress')
      return '任务「' + task.name + '」更新完成：' + done.join('；')
    }),
  })

  tool({
    name: 'cindy_create_product',
    description: '创建产品：在根目录下建立产品文件夹（产品名即文件夹名）。',
    parameters: {
      name: { type: 'string', description: '产品名，如 B300雷达', required: true },
      note: { type: 'string', description: '备注（可选）' },
    },
    output: out,
    execute: run(async (args) => {
      if (!config) throw new Error('尚未设置根目录，请先调用 cindy_set_root')
      const r = await createProductInner({ name: args.name, note: args.note })
      return '产品「' + r.product.name + '」已创建（文件夹：' + r.product.folder + '）'
    }),
  })

  tool({
    name: 'cindy_create_template',
    description: '创建文件夹模板：新建任务时按该模板一键生成目录结构；每行一个文件夹路径，可用 | 追加说明，支持嵌套路径。',
    parameters: {
      name: { type: 'string', description: '模板名', required: true },
      items: { type: 'array', description: '文件夹结构数组，每项形如 {path:"script",desc:"存放脚本"}', required: true },
      note: { type: 'string', description: '备注（可选）' },
    },
    output: out,
    execute: run(async (args) => {
      if (!config) throw new Error('尚未设置根目录，请先调用 cindy_set_root')
      const r = await createTemplateInner({ name: args.name, items: args.items, note: args.note })
      return '模板「' + r.template.name + '」已创建，包含 ' + r.template.items.length + ' 个目录项'
    }),
  })

  tool({
    name: 'cindy_tasks',
    description: '列出任务，可按产品或阶段过滤。',
    parameters: {
      product: { type: 'string', description: '产品名或 ID（可选）' },
      stage: { type: 'string', description: '阶段名（可选）' },
    },
    output: out,
    execute: run(async (args) => {
      if (!config) return 'Cindy 尚未设置根目录。'
      let list = tasks
      if (args.product) { const p = findProduct(args.product); list = p ? list.filter((t) => t.productId === p.id) : [] }
      if (args.stage) list = list.filter((t) => t.stage === args.stage)
      if (list.length === 0) return '没有符合条件的任务。'
      return list.map((t) => '- ' + t.name + '（' + pname(t.productId) + '，ID: ' + t.id + '）：' + t.stage + ' · ' + t.progress + '% · 截止 ' + (t.dueDate || '未定')).join('\n')
    }),
  })

  tool({
    name: 'cindy_daily_summary',
    description: '生成本日工作总结（Markdown，保存到根目录 .taskman/reports/）。',
    parameters: {},
    output: out,
    execute: run(async () => {
      const key = dateStr(new Date())
      const r = await generateReportInner('daily', key)
      return '已生成每日总结：' + r.id + '\n文件：' + r.file + '\n\n' + r.content.split('\n').slice(0, 40).join('\n')
    }),
  })

  tool({
    name: 'cindy_weekly_report',
    description: '生成本周周报（Markdown，保存到根目录 .taskman/reports/）。',
    parameters: {},
    output: out,
    execute: run(async () => {
      const wk = isoWeekOf(new Date())
      const key = wk.year + '-W' + pad(wk.week)
      const r = await generateReportInner('weekly', key)
      return '已生成周报：' + r.id + '\n文件：' + r.file + '\n\n' + r.content.split('\n').slice(0, 40).join('\n')
    }),
  })

  // ---------- 自动恢复根目录（固化版：开机零配置）----------
  // 候选：环境变量 CINDY_ROOT（可配置）> 已知历史数据根目录 > 从已注册工作区逐级上溯找 .taskman/config.json。
  const AUTO_ROOT_CANDIDATES = ['D:\\deepseek_workspace\\taskman-demo', (typeof process !== 'undefined' && process.env && process.env.CINDY_ROOT) || ''].filter(Boolean)
  async function tryRestoreRoot() {
    if (config) return
    const seen = new Set()
    const candidates = [...AUTO_ROOT_CANDIDATES]
    try {
      for (const w of (wsReg.list() || [])) {
        let p = String(w.path || '').replace(/[\\/]+$/, '')
        for (let i = 0; i < 4 && p; i++) {
          candidates.push(p)
          const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
          if (slash <= 0) break
          p = p.slice(0, slash)
        }
      }
    } catch (e) {}
    for (const c of candidates) {
      const key = norm(c)
      if (!c || seen.has(key)) continue
      seen.add(key)
      try {
        const st = await fs.stat(await fs.resolve(c + '/.taskman/config.json'))
        if (st !== undefined) {
          await setRootInner(c)
          console.log('[cindy] 已自动恢复根目录：' + c)
          return
        }
      } catch (e) { /* 尝试下一个候选 */ }
    }
  }

  // ---------- 定时与事件 ----------
  ctx.interval(() => { refreshSessionMap() }, 60 * 1000)
  ctx.interval(() => { schedulerTick() }, 5 * 60 * 1000)
  ctx.timeout(() => { tryRestoreRoot().catch(() => {}); refreshSessionMap(); schedulerTick() }, 5000)
  ctx.on('tools/result', onToolResult)
  ctx.on('agent/status', onAgentStatus)
  console.log('[cindy] Host 半边已启动（任务秘书）')
}
