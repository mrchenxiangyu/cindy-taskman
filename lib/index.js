// =====================================================================
// Cindy 任务秘书 — Host 半边（DSH 正式插件格式）
// 由 taskman 动态插件固化而来：
//  - RPC：TypertRemoteService('cindy') + invoke(method, args)，
//    网关以严格描述符（透传 codec）自动暴露 cindy/invoke 端点；
//  - 工具：ctx.tools.register(defineTool(...))，13 个 cindy_* 模型工具（含会议）；
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
  // 阶段列表可自定义：存于 config.stages（.taskman/config.json），缺省用默认五段。
  // 语义约定：最后一个阶段 = 已关闭/归档（任务进入该阶段即记 closedAt；统计、报告、逾期判定按“最后阶段”算关闭）。
  const DEFAULT_STAGES = ['需求收集', '方案设计', '执行验证', '总结归档', '已关闭']
  const stages = () => (config && Array.isArray(config.stages) && config.stages.length ? config.stages : DEFAULT_STAGES)
  const closedStage = () => { const s = stages(); return s[s.length - 1] }
  const PRIORITIES = ['高', '中', '低']
  const ACTION_STATUSES = ['待办', '进行中', '已完成', '已取消']
  const DEFAULT_DAILY_TIME = '18:00'
  const DEFAULT_WEEKLY_DAY = 1

  // ---------- 状态 ----------
  let config = null
  let products = []
  let templates = []
  let tasks = []
  let meetings = []
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
  const mutex = (fn, ms = 60000) => {
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
  // 批量建目录：一次 shell 调用建多个（cmd mkdir 支持多参数且自动建中间目录），
  // 避免逐个 spawn 进程拖慢 create-task（超时根因之一）。
  async function ensureDirs(paths) {
    const missing = []
    for (const p of paths) if (!(await exists(p))) missing.push(p)
    if (missing.length === 0) return true
    if (shellSvc !== undefined) {
      try {
        const args = missing.map((p) => '"' + String(fs.processPath ? fs.processPath(p) : p).replace(/"/g, '') + '"').join(' ')
        const spec = shellSvc.resolve({ command: 'mkdir ' + args })
        await shellSvc.run(spec)
        for (const p of missing) if (!(await exists(p))) return false
        return true
      } catch (e2) {
        console.error('[cindy] shell 批量建目录失败：' + missing.length + ' 个', e2)
      }
    }
    for (const p of missing) {
      try { await wt(p + '/.taskman-keep', ''); if (!(await exists(p))) return false } catch (e) { return false }
    }
    return true
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
    const mts = await j('meetings.json')
    products = Array.isArray(ps) ? ps : []
    templates = Array.isArray(tps) ? tps : []
    tasks = Array.isArray(tks) ? tks : []
    meetings = Array.isArray(mts) ? mts : []
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
    const rawStages = (existing && Array.isArray(existing.stages)) ? existing.stages.map((s) => String(s).trim()).filter(Boolean) : []
    config = {
      root,
      dailyTime: (existing && existing.dailyTime) || DEFAULT_DAILY_TIME,
      weeklyDay: (existing && existing.weeklyDay) || DEFAULT_WEEKLY_DAY,
      stages: rawStages.length ? rawStages : DEFAULT_STAGES.slice(),
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
    await writeRootMarker(root)
    return { ok: true }
  }

  // ---------- 产品 ----------
  // 产品文件夹 = harness 产品工作区（任务工作区按路径挂在其下，侧边栏据此显示两级树）。
  async function ensureProductWorkspace(p) {
    if (!p || !config) return false
    const byPath = {}
    for (const w of (wsReg.list() || [])) {
      try { const wp = norm(String(w.path || '')); if (wp) byPath[wp] = String(w.id) } catch (e) {}
    }
    let wid = (p.workspaceId && wsReg.get(p.workspaceId)) ? String(p.workspaceId) : byPath[norm(config.root + '/' + p.folder)]
    if (!wid) {
      try {
        const created = await wsReg.create(config.root + '/' + p.folder, p.name)
        wid = created && created.id ? String(created.id) : null
      } catch (e) { console.error('[cindy] 注册产品工作区失败：' + p.name, e) }
    }
    if (wid && p.workspaceId !== wid) { p.workspaceId = wid; return true }
    return false
  }
  async function createProductInner(args) {
    const name = sanitize(args.name)
    if (!name) throw new Error('产品名不能为空')
    if (products.some((x) => x.name === name)) throw new Error('同名产品已存在')
    const item = { id: uid('p'), name, folder: name, note: String(args.note || ''), createdAt: nowIso() }
    await ensureDir(config.root + '/' + item.folder)
    try { await wt(config.root + '/' + item.folder + '/README.md', '# 产品：' + name + '\n\n' + (item.note || '产品工作目录。') + '\n') } catch (e) {}
    products.push(item)
    await ensureProductWorkspace(item)
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
    if (args.name !== undefined && p.workspaceId) {
      try { const ws = wsReg.get(p.workspaceId); if (ws) await ws.setTitle(p.name) } catch (e) { console.error('[cindy] 同步产品工作区标题失败', e) }
    }
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
    // 幂等：同名任务已存在时（典型场景 = 上次请求超时但实际已创建成功），直接返回现有任务，不再报重名
    const existing = tasks.find((t) => norm(t.folder) === norm(folder))
    if (existing) {
      return { ok: true, task: clone(existing), duplicate: true, message: '任务已存在（可能为上次创建超时但实际已成功），返回现有任务' }
    }
    // 批量创建目录（一次 shell 调用），避免逐目录 spawn 进程导致超时
    const dirs = [folder]
    for (const item of (tpl.items || [])) {
      const rel = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '')
      if (rel) dirs.push(folder + '/' + rel)
    }
    if (!(await ensureDirs(dirs))) throw new Error('无法创建任务目录：' + folder)
    const created = []
    for (const item of (tpl.items || [])) {
      const rel = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '')
      if (!rel) continue
      created.push(rel)
      if (item.desc) {
        try { await wt(folder + '/' + rel + '/README.md', '# ' + rel + '\n\n' + item.desc + '\n') } catch (e) {}
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
      '- 当前阶段：' + stages()[0], '',
      '本目录结构由模板「' + tpl.name + '」生成。',
    ].join('\n')
    await wt(folder + '/README.md', meta)
    let workspaceId = null
    let productWSDirty = false
    try {
      productWSDirty = await ensureProductWorkspace(product)
      const ws = await wsReg.create(folder, taskName)
      workspaceId = ws && ws.id ? String(ws.id) : null
    } catch (e) { console.error('[cindy] 注册工作区失败', e) }
    const task = {
      id: uid('t'), productId: product.id, templateId: tpl.id, name: taskName, folder,
      workspaceId, stage: stages()[0], priority: pri,
      startDate: sd, dueDate: dd, note: String(args.note || ''), progress: 0,
      createdAt: nowIso(), updatedAt: nowIso(), closedAt: null,
    }
    tasks.push(task)
    await saveTableInner('tasks', tasks)
    if (productWSDirty) await saveTableInner('products', products)
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
      if (stages().indexOf(patch.stage) < 0) throw new Error('未知阶段')
      notes.push({ kind: 'stage', text: '阶段变更：' + task.stage + ' → ' + patch.stage })
      task.stage = patch.stage
      task.closedAt = patch.stage === closedStage() ? nowIso() : task.closedAt
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

  // ---------- 会议 ----------
  // 会议记录 = 结构化会议（讨论/结论/行动项），存 .taskman/meetings.json；
  // 同时为每场会议在任务目录 project/会议记录/ 生成 Markdown 纪要，便于留存与人工翻阅。
  const actionStatusValid = (s) => ACTION_STATUSES.indexOf(s) >= 0
  async function saveMeetingsInner() { await saveTableInner('meetings', meetings) }
  function buildMinutesMd(task, m, productName) {
    const L = []
    L.push('# 会议记录：' + m.title)
    L.push('')
    L.push('- 产品：' + productName)
    L.push('- 任务：' + task.name)
    L.push('- 日期：' + m.date + (m.time ? ' ' + m.time : ''))
    L.push('- 参会人：' + (m.attendees && m.attendees.length ? m.attendees.join('、') : '未记录'))
    L.push('')
    L.push('## 讨论内容')
    L.push(m.summary || '（未记录）')
    L.push('')
    L.push('## 结论')
    L.push(m.conclusions || '（未记录）')
    L.push('')
    L.push('## 行动项')
    if (!m.actions || m.actions.length === 0) {
      L.push('（无）')
    } else {
      for (const a of m.actions) {
        const mark = a.status === '已完成' ? 'x' : ' '
        const owner = a.owner ? ' — ' + a.owner : ''
        const due = a.due ? '（截止 ' + a.due + '）' : ''
        L.push('- [' + mark + '] ' + a.text + owner + due + '（' + a.status + '）')
      }
    }
    L.push('')
    L.push('---')
    L.push('*由 Cindy 自动生成*')
    return L.join('\n')
  }
  async function createMeetingInner(args) {
    const task = findTask(args.task)
    if (!task) throw new Error('任务不存在：' + args.task)
    const title = String(args.title || '').trim()
    if (!title) throw new Error('会议主题不能为空')
    const date = validDate(args.date) || dateStr(new Date())
    const attendees = (Array.isArray(args.attendees) ? args.attendees : []).map((x) => String(x).trim()).filter(Boolean)
    const actions = (Array.isArray(args.actions) ? args.actions : []).filter((a) => a && String(a.text || '').trim())
      .map((a) => ({
        id: uid('a'), text: String(a.text).trim(),
        owner: String(a.owner || '').trim(), due: validDate(a.due),
        status: actionStatusValid(a.status) ? a.status : '待办', updatedAt: nowIso(),
      }))
    const meeting = {
      id: uid('m'), taskId: task.id, title, date,
      time: String(args.time || '').trim(), attendees,
      summary: String(args.summary || '').trim(),
      conclusions: String(args.conclusions || '').trim(),
      actions, minutesFile: null, createdAt: nowIso(), updatedAt: nowIso(),
    }
    const dir = task.folder + '/project/会议记录'
    await ensureDir(dir)
    const file = dir + '/' + date + '-' + sanitize(title) + '.md'
    try {
      await wt(file, buildMinutesMd(task, meeting, pname(task.productId)))
      meeting.minutesFile = file
    } catch (e) {
      console.error('[cindy] 会议纪要写入失败：' + file, e)
    }
    meetings.push(meeting)
    await saveMeetingsInner()
    await appendJournalInner({ kind: 'meeting', taskId: task.id, source: 'user', text: '会议记录「' + title + '」（' + date + '），行动项 ' + actions.length + ' 条' })
    return { ok: true, meeting: clone(meeting), minutesFile: meeting.minutesFile }
  }
  async function meetingsInner(args) {
    let list = meetings
    if (args && args.task) {
      const task = findTask(args.task)
      if (!task) throw new Error('任务不存在：' + args.task)
      list = list.filter((m) => m.taskId === task.id)
    }
    const today = dateStr(new Date())
    const out = list.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((m) => {
      const total = m.actions.length
      const done = m.actions.filter((a) => a.status === '已完成').length
      const overdue = m.actions.filter((a) => (a.status === '待办' || a.status === '进行中') && a.due && a.due < today).length
      const task = tasks.find((t) => t.id === m.taskId)
      return {
        id: m.id, taskId: m.taskId, taskName: task ? task.name : '未知任务',
        title: m.title, date: m.date, time: m.time, attendees: m.attendees,
        summary: m.summary, conclusions: m.conclusions,
        total, doneCount: done, pendingCount: total - done, overdueCount: overdue,
        minutesFile: m.minutesFile, createdAt: m.createdAt, updatedAt: m.updatedAt,
      }
    })
    return { ok: true, list: out }
  }
  async function meetingInner(args) {
    const meeting = meetings.find((m) => m.id === args.meeting)
    if (!meeting) throw new Error('会议不存在：' + args.meeting)
    return { ok: true, meeting: clone(meeting) }
  }
  async function meetingActionInner(args) {
    const meeting = meetings.find((m) => m.id === args.meeting)
    if (!meeting) throw new Error('会议不存在：' + args.meeting)
    const action = meeting.actions.find((a) => a.id === args.action)
    if (!action) throw new Error('行动项不存在：' + args.action)
    const changes = []
    if (args.status !== undefined) {
      if (!actionStatusValid(args.status)) throw new Error('未知状态：' + args.status)
      if (action.status !== args.status) { action.status = args.status; changes.push('状态→' + args.status) }
    }
    if (args.owner !== undefined) { action.owner = String(args.owner || '').trim(); changes.push('负责人更新') }
    if (args.due !== undefined) {
      const v = validDate(args.due)
      if (args.due !== '' && !v) throw new Error('截止日期格式应为 YYYY-MM-DD')
      action.due = v
      if (v) changes.push('截止更新')
    }
    if (args.text !== undefined && String(args.text).trim()) { action.text = String(args.text).trim(); changes.push('描述更新') }
    action.updatedAt = nowIso()
    meeting.updatedAt = nowIso()
    await saveMeetingsInner()
    // 同步刷新 Markdown 纪要，保证 project/会议记录/ 里的文件与行动项状态一致
    if (meeting.minutesFile) {
      const task = tasks.find((t) => t.id === meeting.taskId)
      try { await wt(meeting.minutesFile, buildMinutesMd(task, meeting, pname(task.productId))) } catch (e) { console.error('[cindy] 会议纪要刷新失败：' + meeting.minutesFile, e) }
    }
    await appendJournalInner({ kind: 'meeting-action', taskId: meeting.taskId, source: 'user', text: '会议「' + meeting.title + '」行动项：' + action.text + (changes.length ? '（' + changes.join('；') + '）' : '') })
    return { ok: true, meeting: clone(meeting), action: clone(action) }
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
    const open = tasks.filter((t) => t.stage !== closedStage())
    const dueToday = open.filter((t) => t.dueDate === today)
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today)
    const activeSessions = {}
    for (const e of entries) if (e.sessionId) activeSessions[e.sessionId] = true
    const fileOps = entries.filter((e) => e.kind === 'session-activity').length
    const stageMoved = byTask.filter((x) => x.stageMoves.length > 0)

    const L = []
    const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
    // 语义记录类型：真正说明“做了什么”的记录；纯命令执行（session-activity）另行统计，不进正文
    const semKinds = { 'task-created': 1, progress: 1, note: 1, stage: 1, meeting: 1, 'meeting-action': 1 }
    const isSem = (e) => semKinds[e.kind]
    const notesOf = (b) => b.entries.filter((e) => e.kind === 'note').map((e) => e.text).filter(Boolean)
    const progOf = (b) => b.entries.filter((e) => e.kind === 'progress' && !/^进度更新为/.test(e.text || '')).map((e) => e.text).filter(Boolean)
    const textOf = (b) => notesOf(b).concat(progOf(b))
    const meetingsOfTask = (taskId) => meetings.filter((m) => m.taskId === taskId && m.date >= from && m.date <= to)
    // 目的：优先任务备注，其次进展中的目的句；都没有则留空（诚实，不编造）
    const purposeOf = (t, texts) => {
      if (t.note && String(t.note).trim()) return String(t.note).trim()
      const hit = texts.find((x) => /目的|目标|为了|期望|要解决|需要解决|需求是|问题是|旨在/.test(x))
      return hit ? clip(hit, 80) : '—'
    }
    // 成果：按句拆进展文本，提取带完成语义的句子；没有则取最后一句，再没有才留空
    const outcomeOf = (texts) => {
      const sents = []
      for (const x of texts) for (const s of String(x).split(/[；;。]/)) {
        const t = s.trim()
        if (t) sents.push(t)
      }
      const hits = sents.filter((s) => /完成|已|实现|新增|交付|发布|上线|通过|产出|文件|脚本|提交|搭建|清理|搞定|建成|改进|优化|验收/.test(s))
      const out = hits.length ? hits : (sents.length ? [sents[sents.length - 1]] : [])
      return out.slice(0, 3).map((s) => clip(s, 80))
    }
    const fmtTime = (e) => String(e.t || '').slice(11, 16)
    const eventLabel = (e) => {
      if (e.kind === 'note') return '📝 ' + clip(e.text, 120)
      if (e.kind === 'progress') return '↗ ' + (e.text || '')
      if (e.kind === 'stage') return '⇄ ' + (e.text || '')
      if (e.kind === 'meeting') return '📅 ' + (e.text || '')
      if (e.kind === 'meeting-action') return '☑ ' + (e.text || '')
      if (e.kind === 'task-created') return '🆕 ' + (e.text || '')
      return clip(e.text, 100)
    }
    // 会议与行动项（全局，按报告范围）
    const rangeMeetings = meetings.filter((m) => m.date >= from && m.date <= to)
    const openActs = []
    for (const m of meetings) for (const a of m.actions) {
      if (a.status === '待办' || a.status === '进行中') {
        const tt = tasks.find((t) => t.id === m.taskId)
        openActs.push({ m, a, task: tt })
      }
    }
    const actOver = openActs.filter((x) => x.a.due && x.a.due < to)
    const actDue = openActs.filter((x) => x.a.due === (kind === 'daily' ? key : today))
    const soon = open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= dateStr(new Date(Date.now() + 2 * 86400000)))
    const noDue = open.filter((t) => !t.dueDate)
    const next7 = open.filter((t) => t.dueDate && t.dueDate > to && t.dueDate <= dateStr(new Date(new Date(to + 'T00:00:00').getTime() + 7 * 86400000)))

    // 简洁过程：一行概括，不列详细时间线
    const processLine = (b, weekly, sessCount) => {
      if (!weekly) {
        const first = b.entries[0]
        const last = b.entries[b.entries.length - 1]
        const span = first && last ? (first.l === last.l ? fmtTime(first) + '–' + fmtTime(last) : fmtTime(first) + '（' + first.l.slice(5) + '）–' + fmtTime(last) + '（' + last.l.slice(5) + '）') : ''
        return (span || '—') + (sessCount ? ' · 会话活动 ' + sessCount + ' 次' : '')
      }
      const days = {}
      for (const e of b.entries) days[e.l] = 1
      const dayList = Object.keys(days).sort()
      return '活跃 ' + dayList.length + ' 天（' + dayList.join('、') + '）' + (sessCount ? ' · 会话活动 ' + sessCount + ' 次' : '')
    }
    let proseLines = []
    // 单个任务块：目的 / 做了什么·方法 / 过程 / 结论 / 成果
    const taskBlock = (b, i, weekly) => {
      const t = b.task
      const sems = b.entries.filter(isSem)
      const texts = textOf(b)
      const mtgs = meetingsOfTask(t.id)
      const stageMoves = b.entries.filter((e) => e.kind === 'stage')
      const sessCount = b.entries.filter((e) => e.kind === 'session-activity').length
      L.push('### ' + (i + 1) + '. ' + t.name + '（' + pname(t.productId) + ' · ' + t.stage + ' · ' + t.progress + '%）')
      L.push('- **目的**：' + purposeOf(t, texts))
      L.push('- **做了什么 / 方法**：' + (texts.length ? '' : '（无文字记录）'))
      for (const x of texts) L.push('  - ' + clip(x, 120))
      if (mtgs.length) for (const m of mtgs) L.push('  - 📅 会议「' + m.title + '」' + (weekly ? '（' + m.date + '）' : '') + '：' + clip(m.conclusions || m.summary || '', 100))
      L.push('- **过程**：' + processLine(b, weekly, sessCount))
      L.push('- **结论**：' + (stageMoves.length ? stageMoves[stageMoves.length - 1].text : '阶段：无变更') + '；进度 ' + t.progress + '%')
      if (mtgs.length) {
        const concl = mtgs.map((m) => m.conclusions).filter(Boolean)
        if (concl.length) L.push('  - 会议结论：' + concl.map((c) => clip(c, 80)).join('；'))
      }
      const outs = outcomeOf(texts)
      L.push('- **成果**：' + (outs.length ? '' : '—'))
      for (const o of outs) L.push('  - ' + o)
      L.push('')
    }
    // 会议与行动项段（两种报告共用）
    const meetingSection = (scopeWord, dueKey) => {
      L.push('## 会议与行动项')
      if (rangeMeetings.length === 0 && openActs.length === 0) {
        L.push('- ' + scopeWord + '无会议，无未完成行动项。')
      } else {
        for (const m of rangeMeetings) {
          const dn = m.actions.filter((a) => a.status === '已完成').length
          L.push('- 📅 会议「' + m.title + '」（' + m.date + '）：行动项 ' + dn + '/' + m.actions.length + ' 已完成')
        }
        if (openActs.length === 0) {
          L.push('- 未完成行动项：无 ✔')
        } else {
          L.push('- 未完成行动项：' + openActs.length + ' 条（⚠️ 逾期 ' + actOver.length + (kind === 'daily' ? '，⏰ 今日截止 ' + actDue.length : '') + '）')
          for (const x of openActs) {
            const warn = x.a.due && x.a.due < dueKey ? ' ⚠️已逾期' : (x.a.due === dueKey ? ' ⏰今日截止' : '')
            L.push('  - [' + x.a.status + '] ' + x.a.text + (x.a.owner ? '（' + x.a.owner + '）' : '') + (x.a.due ? '，截止 ' + x.a.due : '') + warn + ' — ' + (x.task ? x.task.name : '未知任务') + '「' + x.m.title + '」')
          }
        }
      }
      L.push('')
    }

    // 散文式概要：几句话概括做了什么 + 明日/下周待办（不涉及具体时间点）
    const proseSummary = (scopeWord, scopeDate) => {
      const out = []
      // —— 做了什么 ——
      const doneParts = []
      for (const b of byTask) {
        if (!b.task) continue
        const t = b.task
        const texts = textOf(b)
        const outs = outcomeOf(texts)
        const mtgs = meetingsOfTask(t.id)
        let core = ''
        if (outs.length) core = outs[0]
        else if (mtgs.length) core = (mtgs.map((m) => m.conclusions || m.summary).filter(Boolean)[0]) || ''
        else if (texts.length) core = clip(texts[texts.length - 1], 60)
        if (core) doneParts.push('「' + t.name + '」' + clip(core, 60))
      }
      out.push(doneParts.length
        ? scopeWord + '推进 ' + doneParts.length + ' 个任务：' + doneParts.join('；') + '。'
        : (byTask.length ? scopeWord + '有任务活动，但未记录文字进展。' : scopeWord + '无任务进展。'))
      // —— 待办 ——
      const todo = []
      const actList = openActs.slice().sort((x, y) => ((x.a.due || '9999') < (y.a.due || '9999') ? -1 : 1)).slice(0, 3)
      if (actList.length) todo.push('行动项：' + actList.map((x) => '「' + x.a.text + '」' + (x.a.owner ? '(' + x.a.owner + ')' : '') + (x.a.due ? '，截止 ' + x.a.due.slice(5) : '')).join('；') + (openActs.length > 3 ? ' 等' + openActs.length + ' 条未完成' : ' 待办'))
      if (scopeWord === '今日') {
        const dueTmrw = open.filter((t) => t.dueDate === dateStr(new Date(new Date(key + 'T00:00:00').getTime() + 86400000)))
        if (dueTmrw.length) todo.push('明日到期：' + dueTmrw.map((t) => '「' + t.name + '」').join('、'))
      } else if (next7.length) {
        todo.push('下周到期：' + next7.map((t) => '「' + t.name + '」').join('、'))
      }
      if (overdue.length) todo.push('逾期任务：' + overdue.map((t) => '「' + t.name + '」').join('、') + ' 需优先处理')
      const plans = rangeMeetings.map((m) => m.conclusions).filter((c) => c && /下一步|接下来|后续|下周|本周|明天|计划|安排|先做|优先|待办/.test(c))
      if (plans.length) todo.push('会议规划：' + plans.map((c) => clip(c, 50)).join('；'))
      out.push((scopeWord === '今日' ? '明日待办：' : '下周计划：') + (todo.length ? todo.join('；') + '。' : '无明确安排。'))
      return out
    }

    if (kind === 'daily') {
      const wd = weekdayName[new Date(key + 'T00:00:00').getDay()]
      L.push('# 📅 工作日报 ' + key + '（星期' + wd + '）')
      L.push('')
      L.push('## 今日概要')
      proseLines = proseSummary('今日', key)
      L.push.apply(L, proseLines)
      L.push('')
      if (byTask.length === 0) {
        L.push('今日暂无任务进展记录。')
        L.push('')
      } else {
        L.push('## 任务进展')
        byTask.forEach((b, i) => { if (b.task) taskBlock(b, i, false) })
      }
      meetingSection('今日', key)
      L.push('## 风险与提醒')
      if (dueToday.length) for (const t of dueToday) L.push('- ⏰ 今日到期：' + t.name)
      if (overdue.length) for (const t of overdue) L.push('- ⚠️ 已逾期：' + t.name + '（截止 ' + t.dueDate + '）')
      if (soon.length) for (const t of soon) L.push('- ⏳ 即将到期（2 天内）：' + t.name + '（' + t.dueDate + '）')
      if (!dueToday.length && !overdue.length && !soon.length) L.push('- 无到期/逾期风险')
      L.push('')
    } else {
      L.push('# 📊 工作周报 ' + key + '（' + from + ' ~ ' + to + '）')
      L.push('')
      L.push('## 本周概要')
      proseLines = proseSummary('本周', to)
      L.push.apply(L, proseLines)
      L.push('')
      if (byTask.length === 0) {
        L.push('本周暂无任务进展记录。')
        L.push('')
      } else {
        L.push('## 任务进展')
        byTask.forEach((b, i) => { if (b.task) taskBlock(b, i, true) })
      }
      meetingSection('本周', to)
      L.push('## 风险与下周计划')
      if (overdue.length) for (const t of overdue) L.push('- ⚠️ 已逾期：' + t.name + '（截止 ' + t.dueDate + '）')
      if (next7.length) for (const t of next7) L.push('- ⏳ 下周到期：' + t.name + '（' + t.dueDate + '）')
      if (noDue.length) L.push('- 未设截止：' + noDue.map((t) => t.name).join('、'))
      if (!overdue.length && !next7.length && !noDue.length) L.push('- 无风险')
      L.push('')
    }
    // ---------- HTML 版报告（美化显示，供面板预览） ----------
    const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const REPORT_CSS = `
.cindy-report{background:#fff;color:#1f2937;font:14px/1.7 "Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;border-radius:12px;overflow:hidden}
.cindy-report header{background:linear-gradient(135deg,#0ea5e9,#7c6cf0);color:#fff;padding:22px 28px}
.cindy-report header h1{font-size:20px;font-weight:700;margin:0}
.cindy-report header p{opacity:.85;font-size:12.5px;margin:4px 0 0}
.cindy-report .body{padding:20px 28px 24px}
.cindy-report h2{font-size:14.5px;color:#0f172a;margin:20px 0 10px;padding-left:9px;border-left:4px solid #0ea5e9}
.cindy-report .summary{background:linear-gradient(135deg,#f0f9ff,#f5f3ff);border:1px solid #e0e7ff;border-radius:10px;padding:12px 16px}
.cindy-report .summary p{margin:4px 0}
.cindy-report .task{border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;margin-bottom:12px;background:#fafbfc}
.cindy-report .task-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.cindy-report .task-name{font-weight:700;font-size:15px}
.cindy-report .badge{font-size:12px;padding:2px 10px;border-radius:999px;background:#e0f2fe;color:#0369a1;white-space:nowrap}
.cindy-report .badge.ok{background:#dcfce7;color:#15803d}
.cindy-report .field{margin:5px 0}
.cindy-report .field b{color:#475569;font-weight:600}
.cindy-report ul{margin:3px 0;padding-left:18px}
.cindy-report li{margin:2px 0}
.cindy-report .muted{color:#6b7280}
.cindy-report .warn{color:#d97706}
.cindy-report .err{color:#dc2626}
.cindy-report .ok{color:#16a34a}
.cindy-report .act{display:flex;gap:8px;align-items:baseline;margin:4px 0}
.cindy-report .st{flex:none;font-size:11px;padding:1px 8px;border-radius:999px}
.cindy-report .st-todo{background:#fef3c7;color:#b45309}
.cindy-report .st-doing{background:#dbeafe;color:#1d4ed8}
.cindy-report footer{text-align:center;color:#9ca3af;font-size:12px;padding:12px;border-top:1px solid #e5e7eb}
`.trim()
    const H = []
    const wdName = kind === 'daily' ? '星期' + weekdayName[new Date(key + 'T00:00:00').getDay()] : ''
    H.push('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(kind === 'daily' ? '工作日报 ' + key : '工作周报 ' + key) + '</title><style>' + REPORT_CSS + '</style></head><body style="margin:0;background:#eef1f6">')
    H.push('<div class="cindy-report"><header><h1>' + (kind === 'daily' ? '📅 工作日报 ' + key : '📊 工作周报 ' + key) + '</h1><p>' + (kind === 'daily' ? wdName : from + ' ~ ' + to) + ' · 由 Cindy 自动生成</p></header><div class="body">')
    H.push('<section class="summary">' + proseLines.map((p) => '<p>' + esc(p) + '</p>').join('') + '</section>')
    if (byTask.length === 0) {
      H.push('<p class="muted">' + (kind === 'daily' ? '今日' : '本周') + '暂无任务进展记录。</p>')
    } else {
      H.push('<h2>任务进展</h2>')
      byTask.forEach((b, i) => {
        if (!b.task) return
        const t = b.task
        const texts = textOf(b)
        const mtgs = meetingsOfTask(t.id)
        const stageMoves = b.entries.filter((e) => e.kind === 'stage')
        const sessCount = b.entries.filter((e) => e.kind === 'session-activity').length
        H.push('<div class="task"><div class="task-head"><span class="task-name">' + (i + 1) + '. ' + esc(t.name) + '</span><span class="badge' + (t.stage === closedStage() ? ' ok' : '') + '">' + esc(t.stage) + ' · ' + t.progress + '%</span></div>')
        H.push('<div class="field"><b>目的：</b>' + esc(purposeOf(t, texts)) + '</div>')
        H.push('<div class="field"><b>做了什么 / 方法：</b>' + (texts.length ? '<ul>' + texts.map((x) => '<li>' + esc(clip(x, 120)) + '</li>').join('') + '</ul>' : '<span class="muted">（无文字记录）</span>') + '</div>')
        for (const m of mtgs) H.push('<div class="field"><b>会议：</b>「' + esc(m.title) + '」' + (kind === 'weekly' ? '（' + esc(m.date) + '）' : '') + '：' + esc(clip(m.conclusions || m.summary || '', 100)) + '</div>')
        H.push('<div class="field"><b>过程：</b>' + esc(processLine(b, kind === 'weekly', sessCount)) + '</div>')
        const concls = mtgs.map((m) => m.conclusions).filter(Boolean)
        H.push('<div class="field"><b>结论：</b>' + esc((stageMoves.length ? stageMoves[stageMoves.length - 1].text : '阶段：无变更') + '；进度 ' + t.progress + '%') + (concls.length ? '；' + esc(concls.map((c) => clip(c, 80)).join('；')) : '') + '</div>')
        const outs = outcomeOf(texts)
        H.push('<div class="field"><b>成果：</b>' + (outs.length ? '<ul>' + outs.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' : '<span class="muted">—</span>') + '</div>')
        H.push('</div>')
      })
    }
    H.push('<h2>会议与行动项</h2>')
    if (rangeMeetings.length === 0 && openActs.length === 0) {
      H.push('<p class="muted">' + (kind === 'daily' ? '今日' : '本周') + '无会议，无未完成行动项。</p>')
    } else {
      for (const m of rangeMeetings) {
        const dn = m.actions.filter((a) => a.status === '已完成').length
        H.push('<div class="field">📅 会议「' + esc(m.title) + '」（' + esc(m.date) + '）：行动项 ' + dn + '/' + m.actions.length + ' 已完成</div>')
      }
      if (openActs.length === 0) {
        H.push('<p class="ok">未完成行动项：无 ✔</p>')
      } else {
        H.push('<p>' + (kind === 'daily' ? '今日' : '本周') + '未完成行动项 ' + openActs.length + ' 条' + (actOver.length ? '（<span class="err">逾期 ' + actOver.length + '</span>）' : '') + '</p>')
        for (const x of openActs) {
          const stCls = x.a.status === '进行中' ? 'st-doing' : 'st-todo'
          const warn = x.a.due && x.a.due < (kind === 'daily' ? key : to) ? ' <span class="err">已逾期</span>' : (x.a.due === key ? ' <span class="warn">今日截止</span>' : '')
          H.push('<div class="act"><span class="st ' + stCls + '">' + esc(x.a.status) + '</span><span>' + esc(x.a.text) + (x.a.owner ? '（' + esc(x.a.owner) + '）' : '') + (x.a.due ? ' · 截止 ' + esc(x.a.due.slice(5)) : '') + warn + ' — ' + esc(x.task ? x.task.name : '未知任务') + '</span></div>')
        }
      }
    }
    H.push('<h2>风险与提醒</h2>')
    const risk = []
    if (kind === 'daily') {
      if (dueToday.length) risk.push('<span class="warn">⏰ 今日到期：' + dueToday.map((t) => esc(t.name)).join('、') + '</span>')
      if (soon.length) risk.push('<span class="warn">⏳ 即将到期（2 天内）：' + soon.map((t) => esc(t.name) + '（' + esc(t.dueDate) + '）').join('、') + '</span>')
    } else {
      if (next7.length) risk.push('<span>⏳ 下周到期：' + next7.map((t) => esc(t.name) + '（' + esc(t.dueDate) + '）').join('、') + '</span>')
      if (noDue.length) risk.push('<span class="muted">未设截止：' + noDue.map((t) => esc(t.name)).join('、') + '</span>')
    }
    if (overdue.length) risk.push('<span class="err">⚠️ 已逾期：' + overdue.map((t) => esc(t.name)).join('、') + '</span>')
    H.push(risk.length ? '<div class="field">' + risk.join('<br>') + '</div>' : '<p class="muted">无到期/逾期风险</p>')
    H.push('</div><footer>由 Cindy 自动生成 · ' + key + '</footer></div></body></html>')
    const htmlFile = config.root + '/.taskman/reports/' + key + '.' + kind + '.html'
    try { await wt(htmlFile, H.join('\n')) } catch (e) { console.error('[cindy] HTML 报告写入失败：' + htmlFile, e) }
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
    // 每次调度先对账：检测工作区目录删除/改名并同步（缺失标记/路径跟随）
    try { await reconcileInner() } catch (e) { console.error('[cindy] 目录对账失败', e) }
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
      // 产品工作区：每个产品确保已注册（旧数据自动补建）；任务工作区按路径挂在其下
      let productsDirty = false
      for (const p of products) {
        if (await ensureProductWorkspace(p)) productsDirty = true
      }
      if (productsDirty) await saveTableInner('products', products)
      for (const task of tasks) {
        // 优先按路径匹配当前注册表（权威），再退回存储的 workspaceId（可能是旧设备的过期 id）
        let wid = byPath[norm(task.folder)] || task.workspaceId
        if (!wid || !wsReg.get(wid)) {
          // 换设备/注册表丢失：按路径找不到工作区时自动补注册（幂等，失败静默，下次轮询重试）
          try {
            const p = findProduct(task.productId)
            if (p) await ensureProductWorkspace(p)
            const created = await wsReg.create(task.folder, task.name)
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

  // ---------- 目录对账（刷新/定时触发） ----------
  // 用户在工作区删除/改名目录后，注册表不感知文件系统变化；此处按磁盘实况对账：
  //  - 目录缺失 → 任务/产品标记 dirMissing（不自动删记录，数据安全优先）
  //  - 产品目录改名 → 在根目录下扫描含该产品任务名子目录的目录自动识别，路径跟随更新
  //  - 目录恢复 → 自动清除缺失标记
  async function reconcileInner() {
    if (!config) return { ok: true, changed: [], missing: [], missingCount: 0 }
    const changed = []
    const missing = []
    let tasksDirty = false
    let productsDirty = false
    const fsExists = async (p) => { try { return (await fs.stat(await fs.resolve(p))) !== undefined } catch (e) { return false } }
    const listNames = async (dir) => {
      try {
        const lst = await fs.listDir(await fs.resolve(dir))
        return lst.map((en) => String(en && en.name !== undefined ? en.name : en))
      } catch (e) { return [] }
    }
    // 1) 产品：目录存在性 + 改名自动识别
    for (const p of products) {
      const oldFolder = p.folder
      const oldPath = config.root + '/' + p.folder
      if (await fsExists(oldPath)) {
        if (p.dirMissing) { delete p.dirMissing; productsDirty = true; changed.push('产品目录已恢复：' + p.name) }
        continue
      }
      const taskNames = tasks.filter((t) => t.productId === p.id).map((t) => t.name).filter(Boolean)
      let found = null
      const rootNames = await listNames(config.root)
      for (const n of rootNames) {
        if (!n || n.startsWith('.')) continue
        const cand = config.root + '/' + n
        if (!(await fsExists(cand)) || taskNames.length === 0) continue
        const subs = new Set(await listNames(cand))
        if (taskNames.some((tn) => subs.has(tn))) {
          if (found === null) found = n
          else { found = 'ambiguous'; break }
        }
      }
      if (found && found !== 'ambiguous' && found !== p.folder) {
        p.folder = found
        p.name = found
        productsDirty = true
        changed.push('产品目录「' + oldFolder + '」已改名 → ' + found)
        for (const t of tasks) if (t.productId === p.id) {
          const oldTaskFolder = t.folder
          t.folder = config.root + '/' + p.folder + '/' + t.name
          if (norm(t.folder) !== norm(oldTaskFolder)) { tasksDirty = true; changed.push('任务路径跟随：' + t.name + ' → ' + t.folder) }
        }
      } else if (!p.dirMissing) {
        p.dirMissing = true
        productsDirty = true
        missing.push('产品目录缺失：' + p.name + '（' + oldPath + '）' + (found === 'ambiguous' ? '；根目录有多个疑似改名目录，未自动处理' : ''))
      }
    }
    if (productsDirty) await saveTableInner('products', products)
    // 2) 任务：目录存在性（产品改名后路径已重算，按新路径判断）
    for (const t of tasks) {
      const product = findProduct(t.productId)
      if (product && product.dirMissing) {
        if (!t.dirMissing) { t.dirMissing = true; tasksDirty = true }
        continue
      }
      if (await fsExists(t.folder)) {
        if (t.dirMissing) { delete t.dirMissing; tasksDirty = true; changed.push('任务目录已恢复：' + t.name) }
        continue
      }
      if (!t.dirMissing) { t.dirMissing = true; tasksDirty = true; missing.push('任务目录缺失：' + t.name + '（' + t.folder + '）') }
    }
    if (tasksDirty) await saveTableInner('tasks', tasks)
    if (changed.length || missing.length) {
      await appendJournalInner({ kind: 'reconcile', taskId: null, source: 'system', text: '目录对账：' + (changed.length ? changed.join('；') : '无路径变更') + (missing.length ? '；缺失 ' + missing.length + ' 项' : '') })
    }
    return { ok: true, changed, missing, missingCount: missing.length }
  }
  const reconcile = () => mutex(() => reconcileInner())

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
    stages().forEach((s) => { byStage[s] = 0 })
    let dueToday = 0
    let overdue = 0
    let active = 0
    for (const t of tasks) {
      byStage[t.stage] = (byStage[t.stage] || 0) + 1
      if (t.stage !== closedStage()) {
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
        config: { root: config.root, dailyTime: config.dailyTime, weeklyDay: config.weeklyDay, stages: stages().slice() },
        products: clone(products),
        templates: clone(templates),
        tasks: clone(tasks),
        meetings: clone(meetings),
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
      if (a.stages !== undefined) {
        if (!Array.isArray(a.stages)) throw new Error('stages 必须是字符串数组')
        const list = a.stages.map((s) => String(s).trim()).filter(Boolean)
        if (list.length === 0) throw new Error('至少需要一个阶段')
        if (list.length > 30) throw new Error('阶段数量不能超过 30 个')
        if (new Set(list).size !== list.length) throw new Error('阶段不能重复')
        config.stages = list
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
      if (!/^[\w.-]+\.(daily|weekly)\.(md|html)$/.test(id)) throw new Error('非法报告名')
      const content = await rt(config.root + '/.taskman/reports/' + id)
      return { ok: true, id, content }
    },
    'task-sessions': () => taskSessionsInner(),
    'reconcile': () => reconcileInner(),
    'create-meeting': (a) => createMeetingInner(a),
    'meetings': (a) => meetingsInner(a),
    'meeting': (a) => meetingInner(a),
    'meeting-action': (a) => meetingActionInner(a),
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
    package: '@mrchenxiangyu/cindy-taskman',
    face: 'host',
    model: { services: [], events: [], objects: [] },
    schemas: [],
    invocations: [
      {
        id: '@mrchenxiangyu/cindy-taskman#cindy/invoke',
        service: 'cindy',
        namespace: 'cindy',
        method: 'invoke',
        invocation: { kind: 'direct' },
        parameters: [
          { name: 'method', wire: 'method', source: 'json', codec: passthrough('@mrchenxiangyu/cindy-taskman/types#Method') },
          { name: 'args', wire: 'args', source: 'json', codec: passthrough('@mrchenxiangyu/cindy-taskman/types#JsonValue') },
        ],
        result: passthrough('@mrchenxiangyu/cindy-taskman/types#JsonValue'),
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
      const due = tasks.filter((t) => t.dueDate === today && t.stage !== closedStage()).map((t) => t.name + '（' + pname(t.productId) + '）')
      const over = tasks.filter((t) => t.dueDate && t.dueDate < today && t.stage !== closedStage()).map((t) => t.name + '（' + pname(t.productId) + '，截止 ' + t.dueDate + '）')
      const lines = ['根目录：' + config.root, '任务总数：' + s.total + '（进行中 ' + s.active + '）']
      lines.push('阶段分布：' + stages().map((st) => st + ' ' + (s.byStage[st] || 0)).join('；'))
      lines.push('今日到期：' + (due.length ? due.join('、') : '无'))
      lines.push('已逾期：' + (over.length ? over.join('、') : '无'))
      lines.push('已建立会话关联的任务会话数：' + s.sessionLinks)
      const missTasks = tasks.filter((t) => t.dirMissing).length
      const missProds = products.filter((p) => p.dirMissing).length
      if (missTasks + missProds) lines.push('⚠️ 目录缺失：' + (missTasks + missProds) + ' 项（任务 ' + missTasks + '、产品 ' + missProds + '，可删除或恢复目录后刷新）')
      const openActs = []
      for (const m of meetings) for (const a of m.actions) if (a.status !== '已完成' && a.status !== '已取消') openActs.push(a)
      const actOver = openActs.filter((a) => a.due && a.due < today).length
      lines.push('会议行动项：未完成 ' + openActs.length + ' 条' + (actOver ? '（⚠️ 逾期 ' + actOver + '）' : ''))
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
      if (r.duplicate) {
        return '任务「' + r.task.name + '」已存在（可能是上次创建超时但实际已成功），直接复用现有任务。\n目录：' + r.task.folder + '\n工作区 ID：' + (r.task.workspaceId || '未注册') + '\n阶段：' + r.task.stage + '，进度：' + r.task.progress + '%'
      }
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
      return list.map((t) => '- ' + t.name + '（' + pname(t.productId) + '，ID: ' + t.id + '）：' + t.stage + ' · ' + t.progress + '% · 截止 ' + (t.dueDate || '未定') + (t.dirMissing ? ' · ⚠️目录缺失' : '')).join('\n')
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

  tool({
    name: 'cindy_create_meeting',
    description: '创建会议记录：为某任务记录一次会议（主题、日期、参会人、讨论内容、结论、行动项），并在任务目录 project/会议记录/ 生成 Markdown 纪要。',
    parameters: {
      task: { type: 'string', description: '任务 ID 或任务名（支持模糊匹配）', required: true },
      title: { type: 'string', description: '会议主题', required: true },
      date: { type: 'string', description: '会议日期 YYYY-MM-DD，缺省今天' },
      time: { type: 'string', description: '时间段，如 14:00-15:30' },
      attendees: { type: 'array', description: '参会人列表，如 ["张三","李四"]' },
      summary: { type: 'string', description: '讨论内容' },
      conclusions: { type: 'string', description: '会议结论 / 接下来的规划' },
      actions: { type: 'array', description: '行动项列表，每项形如 {text:"要做什么", owner:"负责人", due:"YYYY-MM-DD"}' },
    },
    output: out,
    execute: run(async (args) => {
      const r = await createMeetingInner(args)
      const m = r.meeting
      const task = tasks.find((t) => t.id === m.taskId)
      return '会议「' + m.title + '」已记录（' + m.date + '，任务：' + (task ? task.name : m.taskId) + '）。\n会议 ID：' + m.id + '\n行动项：' + m.actions.length + ' 条。\n纪要文件：' + (r.minutesFile || '未生成')
    }),
  })

  tool({
    name: 'cindy_meetings',
    description: '查看会议列表：按任务列出会议记录及每场会议行动项完成情况（已完成/总数、逾期数）。',
    parameters: {
      task: { type: 'string', description: '任务 ID 或任务名（可选，缺省列出全部会议）' },
    },
    output: out,
    execute: run(async (args) => {
      const r = await meetingsInner(args || {})
      const list = r.list
      if (list.length === 0) return '暂无会议记录。'
      return list.map((m) => {
        let line = '- ' + m.date + '「' + m.title + '」（' + m.taskName + '，ID: ' + m.id + '）：行动项 ' + m.doneCount + '/' + m.total + ' 已完成'
        if (m.overdueCount) line += '，⚠️ 逾期 ' + m.overdueCount + ' 条'
        return line
      }).join('\n')
    }),
  })

  tool({
    name: 'cindy_meeting',
    description: '查看单场会议详情：含讨论内容、结论和完整行动项清单（状态/负责人/截止日期）。',
    parameters: {
      meeting: { type: 'string', description: '会议 ID', required: true },
    },
    output: out,
    execute: run(async (args) => {
      const r = await meetingInner(args)
      const m = r.meeting
      const task = tasks.find((t) => t.id === m.taskId)
      const L = []
      L.push('会议：' + m.title + '（' + m.date + (m.time ? ' ' + m.time : '') + '）')
      L.push('任务：' + (task ? task.name : m.taskId))
      L.push('参会人：' + (m.attendees && m.attendees.length ? m.attendees.join('、') : '未记录'))
      L.push('')
      L.push('【讨论内容】')
      L.push(m.summary || '（未记录）')
      L.push('')
      L.push('【结论 / 规划】')
      L.push(m.conclusions || '（未记录）')
      L.push('')
      L.push('【行动项】')
      if (!m.actions || m.actions.length === 0) {
        L.push('（无）')
      } else {
        for (const a of m.actions) {
          const mark = a.status === '已完成' ? '[x]' : (a.status === '已取消' ? '[~]' : '[ ]')
          L.push('- ' + mark + ' ' + a.text + '（' + a.status + (a.owner ? '，' + a.owner : '') + (a.due ? '，截止 ' + a.due : '') + '，ID: ' + a.id + '）')
        }
      }
      if (m.minutesFile) {
        L.push('')
        L.push('纪要文件：' + m.minutesFile)
      }
      return L.join('\n')
    }),
  })

  tool({
    name: 'cindy_meeting_action',
    description: '更新会议行动项：按会议 ID 与行动项 ID 更新状态（待办/进行中/已完成/已取消）、负责人、截止日期或描述；状态变更自动记入日志。',
    parameters: {
      meeting: { type: 'string', description: '会议 ID', required: true },
      action: { type: 'string', description: '行动项 ID', required: true },
      status: { type: 'string', description: '新状态：待办/进行中/已完成/已取消' },
      owner: { type: 'string', description: '负责人' },
      due: { type: 'string', description: '截止日期 YYYY-MM-DD' },
      text: { type: 'string', description: '描述' },
    },
    output: out,
    execute: run(async (args) => {
      const r = await meetingActionInner(args)
      return '已更新会议「' + r.meeting.title + '」行动项：' + r.action.text + ' → ' + r.action.status
    }),
  })
  // ---------- 根目录记忆与恢复 ----------
  // 不硬编码任何机器路径：首次使用由用户在面板引导中选择根目录；选择结果写入
  // DSH 用户目录下的 cindy-root.json，之后每次启动自动恢复该目录。
  // 可选：设置环境变量 CINDY_ROOT 可覆盖记忆值（便于脚本化部署）。
  function dshHomeDir() {
    const env = (typeof process !== 'undefined' && process.env) ? process.env : {}
    return (env.DSH_HOME || ((env.USERPROFILE || env.HOME || '') + '/.dsh')).replace(/[\\/]+$/, '')
  }
  function rootMarkerPath() { return dshHomeDir() + '/cindy-root.json' }
  async function readRootMarker() {
    try {
      const raw = await fs.readText(await fs.resolve(rootMarkerPath()))
      const j = JSON.parse(raw)
      return (j && typeof j.root === 'string' && j.root) ? j.root : null
    } catch (e) { return null }
  }
  async function writeRootMarker(root) {
    try {
      // 记忆文件位于 DSH 用户目录（数据根目录之外），直接写、不走 wt 的包含性校验
      const target = await fs.resolve(rootMarkerPath())
      await fs.writeText(target, JSON.stringify({ root, updatedAt: nowIso() }, null, 2), undefined, undefined, fullPolicy)
    } catch (e) {
      console.error('[cindy] 根目录记忆写入失败（不影响本次使用，下次需重新选择）：', String((e && e.message) || e))
    }
  }
  async function tryRestoreRoot() {
    if (config) return
    const candidates = [
      await readRootMarker(),
      (typeof process !== 'undefined' && process.env && process.env.CINDY_ROOT) || '',
    ].filter(Boolean)
    const seen = new Set()
    for (const c of candidates) {
      const key = norm(c)
      if (!c || seen.has(key)) continue
      seen.add(key)
      try {
        const st = await fs.stat(await fs.resolve(c + '/.taskman/config.json'))
        if (st !== undefined) {
          await setRootInner(c)
          console.log('[cindy] 已恢复根目录：' + c)
          return
        }
      } catch (e) { /* 尝试下一个候选 */ }
    }
  }

  // ---------- 定时与事件 ----------
  ctx.interval(() => { refreshSessionMap() }, 60 * 1000)
  ctx.interval(() => { schedulerTick() }, 5 * 60 * 1000)
  // 启动瞬间即恢复根目录（不等 5s），让浏览器首次请求时数据已就绪；5s 兜底重试
  tryRestoreRoot().catch(() => {})
  ctx.timeout(() => { refreshSessionMap(); schedulerTick(); tryRestoreRoot().catch(() => {}) }, 5000)
  ctx.on('tools/result', onToolResult)
  ctx.on('agent/status', onAgentStatus)
  console.log('[cindy] Host 半边已启动（任务秘书）')
}
