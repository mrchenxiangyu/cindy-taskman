// =====================================================================
// Cindy 任务秘书 — Client 半边（DSH web 模块格式，预构建 bundle）
// 入口：侧边栏底部「Cindy」按钮 → shell.overlay 浮动面板
// 面板页签：总览（按产品/阶段分组）/ 日历（日·周·月）/ 甘特图 / 日志 / 设置
// RPC：ctx.remote.$mount 挂载 cindy/invoke 端点 → ns.invoke(method, args)
// 性能：插槽同步注册（不等 RPC）、call 懒等待就绪、apply 预取状态 → 首开即快
// 样式：全部使用 DSH 主题 token（--dsw-*），明暗主题自适应
// =====================================================================
window.__ModuleLoader__.load({
  id: '@mrchenxiangyu/cindy-taskman',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // ---------- 样式（主题 token 驱动，明暗自适应）----------
    const CSS = `
.tk-panel{position:fixed;display:flex;flex-direction:column;overflow:hidden;border-radius:16px;border:1px solid var(--dsw-alias-border-l2, rgba(148,163,184,.35));background:var(--dsw-alias-bg-overlay, #1b2431);color:var(--dsw-alias-label-primary, #e5e7eb);font-size:13px;line-height:1.55;box-sizing:border-box;box-shadow:0 24px 80px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.2)}
.tk-panel *{box-sizing:border-box}
.tk-panel ::-webkit-scrollbar{width:8px;height:8px}
.tk-panel ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2, rgba(148,163,184,.35));border-radius:8px}
.tk-panel ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2, rgba(148,163,184,.55))}
.tk-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.2));background:color-mix(in srgb, var(--dsw-alias-bg-layer-1, #232f3e) 60%, transparent)}
.tk-title{font-weight:700;font-size:14px;letter-spacing:.2px;white-space:nowrap;display:flex;align-items:center;gap:8px}
.tk-dim{color:var(--dsw-alias-label-secondary, #9ca3af)}
.tk-err{color:var(--dsw-alias-state-error-primary, #f87171);font-size:12px}
.tk-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.2));background:color-mix(in srgb, var(--dsw-alias-bg-layer-1, #232f3e) 40%, transparent)}
.tk-tab{background:none;border:1px solid transparent;color:var(--dsw-alias-label-secondary, #9ca3af);padding:6px 14px;cursor:pointer;font-size:12.5px;border-radius:8px;transition:all .15s ease;font-family:inherit}
.tk-tab:hover{color:var(--dsw-alias-label-primary, #e5e7eb);background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06))}
.tk-tab.on{color:#fff;background:linear-gradient(135deg, var(--dsw-alias-brand-primary, #38bdf8), #7c6cf0);font-weight:600;box-shadow:0 2px 8px rgba(56,189,248,.35)}
.tk-body{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
.tk-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tk-btn{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.08));color:var(--dsw-alias-label-primary, #e5e7eb);border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.3));border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;transition:all .15s ease;font-family:inherit}
.tk-btn:hover{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.14));border-color:var(--dsw-alias-brand-primary, #38bdf8)}
.tk-btn.primary{background:linear-gradient(135deg, var(--dsw-alias-brand-primary, #38bdf8), #7c6cf0);border-color:transparent;color:#fff;font-weight:600;box-shadow:0 2px 10px rgba(56,189,248,.3)}
.tk-btn.primary:hover{filter:brightness(1.08)}
.tk-btn.danger{background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 14%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 50%, transparent);color:var(--dsw-alias-state-error-primary, #f87171)}
.tk-btn.ghost{background:none;border-color:transparent}
.tk-btn.ghost:hover{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.1))}
.tk-btn.tk-icn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:8px;color:var(--dsw-alias-label-secondary, #9ca3af)}
.tk-btn.tk-icn:hover{color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-btn:disabled{opacity:.5;cursor:default;pointer-events:none}
.tk-input{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.3));border-radius:8px;color:var(--dsw-alias-label-primary, #e5e7eb);padding:7px 10px;font-size:12.5px;outline:none;font-family:inherit;transition:border-color .15s ease}
.tk-input:focus{border-color:var(--dsw-alias-brand-primary, #38bdf8);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #38bdf8) 20%, transparent)}
.tk-input::placeholder{color:var(--dsw-alias-label-secondary, #9ca3af)}
.tk-stat{background:linear-gradient(180deg, var(--dsw-alias-bg-layer-1, rgba(255,255,255,.05)), var(--dsw-alias-bg-layer-2, rgba(255,255,255,.03)));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.25));border-radius:12px;padding:10px 16px;min-width:72px;text-align:center;transition:transform .15s ease}
.tk-stat:hover{transform:translateY(-1px)}
.tk-stat-v{font-size:20px;font-weight:800;letter-spacing:-.5px}
.tk-stat-l{font-size:11px;color:var(--dsw-alias-label-secondary, #9ca3af);margin-top:2px}
.tk-cols{display:flex;gap:12px;flex:1;min-height:0;align-items:stretch}
.tk-col{flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.2));border-radius:12px;padding:12px;overflow:auto;max-height:100%}
.tk-col-head{display:flex;align-items:center;justify-content:space-between}
.tk-col-title{font-weight:700;font-size:12.5px;color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-card{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.22));border-radius:12px;padding:11px 12px;cursor:pointer;transition:all .15s ease}
.tk-card:hover{border-color:var(--dsw-alias-brand-primary, #38bdf8);transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.18)}
.tk-card-name{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid;font-weight:600;letter-spacing:.2px}
.tk-prog{height:6px;background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.1));border-radius:3px;overflow:hidden}
.tk-prog>div{height:100%;background:linear-gradient(90deg, var(--dsw-alias-brand-primary, #38bdf8), #7c6cf0);border-radius:3px;transition:width .3s ease}
.tk-empty{color:var(--dsw-alias-label-secondary, #9ca3af);font-size:12px;padding:16px;text-align:center;border:1px dashed var(--dsw-alias-border-l2, rgba(148,163,184,.35));border-radius:12px}
.tk-modal{position:fixed;inset:0;background:rgba(8,12,20,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:600;pointer-events:auto}
.tk-modal-card{width:720px;max-width:calc(100vw - 40px);max-height:calc(100vh - 60px);overflow:auto;background:var(--dsw-alias-bg-overlay, #1b2431);color:var(--dsw-alias-label-primary, #e5e7eb);border:1px solid var(--dsw-alias-border-l2, rgba(148,163,184,.35));border-radius:16px;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.5)}
.tk-modal-title{font-weight:700;font-size:15px}
.tk-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.tk-field-label{font-size:11px;color:var(--dsw-alias-label-secondary, #9ca3af);font-weight:600;letter-spacing:.3px}
.tk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tk-sec{font-weight:700;font-size:11.5px;color:var(--dsw-alias-brand-primary, #38bdf8);text-transform:uppercase;letter-spacing:1px;margin-top:8px}
.tk-sec-card{background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.18));border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.tk-sec-card>.tk-sec{margin:0}
.tk-hint{color:var(--dsw-alias-label-secondary, #9ca3af);font-size:11px;line-height:1.65}
.tk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;align-items:start}
.tk-grid>.tk-empty{grid-column:1/-1}
.tk-body>*{min-width:0}
.tk-row{min-width:0}
.tk-row>*{min-width:0}
.tk-input{min-width:0}
.tk-field{min-width:0}
.tk-logs{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto}
.tk-log{display:flex;gap:8px;font-size:12px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.03));border-radius:8px;align-items:baseline}
.tk-log:hover{background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.06))}
.tk-log-t{color:var(--dsw-alias-label-secondary, #9ca3af);font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}
.tk-log-k{color:var(--dsw-alias-brand-primary, #38bdf8);font-size:10px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #38bdf8) 45%, transparent);border-radius:5px;padding:0 6px;white-space:nowrap;font-weight:600}
.tk-log-x{flex:1;color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-cal-head{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.tk-cal-wh{text-align:center;color:var(--dsw-alias-label-secondary, #9ca3af);font-size:11px;padding:3px;font-weight:600}
.tk-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.tk-cal-cell{min-height:84px;border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.2));border-radius:10px;padding:5px;overflow:hidden;background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.03));cursor:pointer;transition:background .15s ease}
.tk-cal-cell:hover{background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.07))}
.tk-cal-cell.other{opacity:.4}
.tk-cal-cell.today{outline:2px solid var(--dsw-alias-brand-primary, #38bdf8);outline-offset:-2px}
.tk-cal-dayhead{font-size:11px;color:var(--dsw-alias-label-secondary, #9ca3af);margin-bottom:3px;font-variant-numeric:tabular-nums}
.tk-cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.tk-cal-title{font-weight:700;font-size:14px;min-width:160px;text-align:center}
.tk-evt{font-size:11px;padding:2px 6px;border-radius:6px;margin-bottom:2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.05));border-left:3px solid #94a3b8;transition:background .15s ease;color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-evt:hover{background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.1))}
.tk-gantt{flex:1;min-height:240px;overflow:auto;border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.25));border-radius:12px;background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.02))}
.tk-gantt-inner{min-width:100%}
.tk-g-row{display:flex;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.1));min-height:30px}
.tk-g-label{position:sticky;left:0;width:220px;min-width:220px;background:var(--dsw-alias-bg-overlay, #1b2431);z-index:2;padding:0 8px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-g-group{font-weight:700;color:var(--dsw-alias-label-secondary, #9ca3af);background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04))}
.tk-g-h{position:absolute;top:0;height:22px;font-size:9px;color:var(--dsw-alias-label-secondary, #9ca3af);border-left:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.2));padding-left:2px;overflow:hidden}
.tk-g-grid{position:absolute;inset:0}
.tk-g-grid i{position:absolute;top:0;bottom:0;border-left:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.06))}
.tk-g-bar{position:absolute;top:4px;height:20px;border-radius:6px;cursor:pointer;display:flex;align-items:center;padding:0 6px;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.15);transition:filter .15s ease}
.tk-g-bar:hover{filter:brightness(1.12)}
.tk-g-bar-label{font-size:10px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.4)}
.tk-g-today{position:absolute;top:0;bottom:0;width:2px;background:var(--dsw-alias-state-error-primary, #f87171);z-index:1}
.tk-pre{white-space:pre-wrap;font-family:var(--dsw-font-mono, ui-monospace, Consolas, monospace);font-size:12px;background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.3));border-radius:10px;padding:12px;color:var(--dsw-alias-label-primary, #e5e7eb)}
.tk-quick{background:var(--dsw-alias-bg-overlay, rgba(15,23,42,.9));border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.3));border-radius:12px;padding:12px;color:var(--dsw-alias-label-primary, #e5e7eb);font-size:13px}
.tk-quick-title{font-weight:700;font-size:13px}
.tk-warnline{font-size:12px;color:var(--dsw-alias-state-warn-primary, #fbbf24);margin-top:6px}
.tk-hero{font-size:44px;text-align:center;line-height:1.2}
.tk-footbtn{background:none;border:none;color:var(--dsw-alias-label-secondary, #9ca3af);cursor:pointer;font-size:12px;display:flex;align-items:center;gap:7px;padding:5px 9px;border-radius:9px;font-family:inherit;transition:all .15s ease}
.tk-footbtn:hover{color:var(--dsw-alias-label-primary, #e5e7eb);background:var(--dsw-alias-bg-layer-2, rgba(56,189,248,.1))}
.tk-detail-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:10px}
.tk-more{cursor:pointer;color:var(--dsw-alias-brand-primary, #38bdf8);font-size:10px;text-align:center;padding:3px 0;border-radius:6px;font-weight:600}
.tk-more:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary, #38bdf8) 14%, transparent)}
.tk-grip{position:absolute;right:2px;bottom:2px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-secondary, #9ca3af);cursor:se-resize;border-radius:6px;user-select:none;touch-action:none}
.tk-perf{position:absolute;left:12px;bottom:5px;font-size:10px;color:var(--dsw-alias-label-secondary, #9ca3af);opacity:.55;pointer-events:none;user-select:none}
.tk-grip:hover{color:var(--dsw-alias-label-primary, #e5e7eb);background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.08))}
.tk-btn:focus-visible,.tk-tab:focus-visible,.tk-input:focus-visible,.tk-modal-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #38bdf8);outline-offset:1px}
.tk-skel{flex:1;min-height:140px;display:flex;flex-direction:column;gap:9px;justify-content:center;padding:0 24px}
.tk-skel-bar{height:14px;border-radius:7px;background:linear-gradient(90deg, rgba(148,163,184,.16) 25%, rgba(148,163,184,.34) 50%, rgba(148,163,184,.16) 75%);background-size:200% 100%;animation:tkShimmer 1.3s infinite}
.tk-skel-label{text-align:center;color:var(--dsw-alias-label-secondary, #9ca3af);font-size:12px;margin-top:6px}
@keyframes tkShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
`
    const CSS_ID = '@mrchenxiangyu/cindy-taskman/ui'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_ID) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@mrchenxiangyu/cindy-taskman'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    const inject = ['slots', 'workspaces']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const timer = ctx.get('timer')
      const wsSvc = ctx.get('workspaces')
      const BUILD = 'fetch-direct'
      console.log('[cindy] apply 开始（build ' + BUILD + '）')

      // ---------- 共享 store（按钮/面板/设置卡片共享状态）----------
      // 面板记忆（localStorage）：位置 / 尺寸 / 当前页签
      const loadPersist = () => {
        try {
          if (typeof localStorage === 'undefined') return {}
          const raw = localStorage.getItem('cindy.panel')
          if (!raw) return {}
          const v = JSON.parse(raw)
          const out = {}
          if (v && typeof v.pos === 'object' && v.pos !== null && Number.isFinite(v.pos.x) && Number.isFinite(v.pos.y)) out.pos = v.pos
          if (v && typeof v.size === 'object' && v.size !== null && Number.isFinite(v.size.w) && Number.isFinite(v.size.h)) {
            out.size = { w: Math.max(640, Math.min(1400, v.size.w)), h: Math.max(420, Math.min(900, v.size.h)) }
          }
          if (v && ['board', 'calendar', 'gantt', 'journal', 'settings'].includes(v.tab)) out.tab = v.tab
          return out
        } catch (e) { return {} }
      }
      const persistStore = () => {
        try {
          if (typeof localStorage === 'undefined') return
          localStorage.setItem('cindy.panel', JSON.stringify({ pos: store.pos, size: store.size, tab: store.tab }))
        } catch (e) {}
      }

      const store = {
        open: false,
        tab: 'board',
        pos: null,
        size: null,
        fullscreen: false,
        state: null,
        configured: false,
        sessions: [],
        error: null,
        connecting: false,
        perf: null,
        detailTaskId: null,
        newTaskProductId: null,
        calView: 'month',
        calCursor: null,
        listeners: new Set(),
        notify() { for (const fn of [...store.listeners]) fn() },
        // 浅比较：只有实际变化的值才通知，避免 30s 自动刷新等无效 set 触发整面板重渲染
        set(p) {
          let changed = false
          for (const k of Object.keys(p)) {
            if (!Object.is(store[k], p[k])) { store[k] = p[k]; changed = true }
          }
          if (changed) { store.notify(); if (p.pos || p.size || p.tab) persistStore() }
        },
      }
      Object.assign(store, loadPersist())

      // 首帧状态缓存：上次成功加载的 get-state 快照存 localStorage，
      // 打开面板瞬间直接渲染（陈旧几秒无妨），后台 refresh 覆盖更新 → 告别首次加载等待
      const loadStateCache = () => {
        try {
          if (typeof localStorage === 'undefined') return null
          const raw = localStorage.getItem('cindy.state')
          if (!raw) return null
          const v = JSON.parse(raw)
          if (v && v.state && typeof v.configured === 'boolean') return v
          return null
        } catch (e) { return null }
      }
      const cachedState = loadStateCache()
      if (cachedState) {
        store.state = cachedState.state
        store.configured = cachedState.configured
      }

      // 独立弹窗模式：URL 带 ?cindy-popup=1 时，本窗口只渲染全屏 Cindy 面板（可拖到其他屏幕）
      const isPopup = typeof window !== 'undefined' && typeof window.location !== 'undefined'
        && new URLSearchParams(window.location.search).get('cindy-popup') === '1'
      if (isPopup) {
        store.open = true
        store.fullscreen = true
        try { document.body.style.overflow = 'hidden' } catch (e) {}
      }

      const useStore = () => {
        const [, f] = React.useState(0)
        React.useEffect(() => {
          const fn = () => f((n) => n + 1)
          store.listeners.add(fn)
          return () => { store.listeners.delete(fn) }
        }, [])
        return store
      }

      // ---------- RPC 通道 ----------
      // 首选：connection 直连（免 $mount / 免命名空间，最稳）；回退：remote.$mount 命名空间。
      // 所有调用都带超时（timer 服务缺失时用浏览器 setTimeout 兜底），绝不无限等待。
      // ---------- RPC 通道：浏览器原生 fetch 直连（不依赖 connection/timer/remote 任何服务）----------
      // 与服务端实测通过的 HTTP 通道完全一致：POST /api/cindy/invoke，client-request 信封。
      let lastTransport = 'fetch'
      const call = async (m, a) => {
        const rpcId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
          : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), 5000)
        console.log('[cindy] call 发起 fetch：' + m)
        let resp
        try {
          resp = await fetch('/api/cindy/invoke', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId, method: 'cindy/invoke', payload: { args: { method: m, args: a || {} } } }),
            signal: controller.signal,
          })
        } catch (e) {
          clearTimeout(tid)
          console.error('[cindy] fetch 异常：', e && e.name, e && e.message)
          const aborted = e && (e.name === 'AbortError' || e.code === 20)
          throw new Error(aborted ? 'Cindy 请求超时：' + m : 'Cindy 网络错误：' + String((e && e.message) || e))
        }
        clearTimeout(tid)
        console.log('[cindy] fetch 完成 HTTP ' + resp.status)
        if (!resp.ok) throw new Error('Cindy HTTP ' + resp.status)
        let full
        try { full = await resp.json() } catch (e) { throw new Error('Cindy 响应解析失败') }
        if (!full || full.rpcId !== rpcId) throw new Error('Cindy 响应校验失败')
        const r = full.result
        if (!r || r.ok === false) {
          const err = r && r.error ? (r.error.message || r.error) : '操作失败'
          throw new Error(typeof err === 'string' ? err : '操作失败')
        }
        const v = r.value
        if (v && v.ok === false) throw new Error(v.error || '操作失败')
        lastTransport = 'fetch'
        return v
      }

      const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
      // refresh：失败立即显示错误（不干等重试），后台继续短间隔重试，成功即清错
      const refresh = async (opts = {}) => {
        const attempts = opts.attempts || 1
        let lastErr = null
        console.log('[cindy] refresh 开始（attempts=' + attempts + '）')
        for (let i = 0; i < attempts; i++) {
          const t0 = Date.now()
          try {
            const r = await call('get-state')
            store.set({ state: r.state, configured: r.configured, error: null, connecting: false, perf: { ms: Date.now() - t0, transport: lastTransport === 'remote' ? 'remote' : 'connection' } })
            if (r.configured) {
              try {
                if (typeof localStorage !== 'undefined') localStorage.setItem('cindy.state', JSON.stringify({ ts: Date.now(), state: r.state, configured: true }))
              } catch (e) {}
            }
            console.log('[cindy] get-state 成功', Date.now() - t0, 'ms ·', lastTransport, '· configured=' + store.configured)
            if (!store.configured) return true
            // 会话关联异步补全，不阻塞首屏
            call('task-sessions').then((t) => {
              if (t && t.list) store.set({ sessions: t.list })
            }).catch(() => {})
            return true
          } catch (e) {
            lastErr = String((e && e.message) || e)
            console.error('[cindy] get-state 失败（第 ' + (i + 1) + ' 次）：', lastErr)
            // 第一次失败就亮出错误，避免用户干等；后台继续重试直到成功
            store.set({ error: lastErr, connecting: i < attempts - 1 })
            if (i < attempts - 1) await sleep(250 + i * 150)
          }
        }
        store.set({ connecting: false })
        return false
      }

      // ---------- 工具函数 ----------
      const h = React.createElement
      const pad = (n) => String(n).padStart(2, '0')
      const dstr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      const parseD = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null }
      const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
      const todayStr = () => dstr(new Date())
      const WEEK = ['一', '二', '三', '四', '五', '六', '日']
      const STAGE_COLORS = { '需求收集': '#8b5cf6', '方案设计': '#3b82f6', '执行验证': '#f59e0b', '总结归档': '#10b981', '已关闭': '#6b7280' }
      const PRI_COLORS = { '高': '#ef4444', '中': '#f59e0b', '低': '#64748b' }
      const KIND_LABEL = { 'task-created': '新建任务', 'stage': '阶段变更', 'progress': '进度', 'note': '记录', 'session-activity': '会话活动', 'daily-summary': '日报', 'weekly-report': '周报', 'system': '系统' }
      const STAGE_ICON = { '需求收集': '📋', '方案设计': '✏️', '执行验证': '⚙️', '总结归档': '📦', '已关闭': '✅' }
      // 稳定日志 key：优先 id，旧数据回退到 时间+类型+会话+文本前缀（绝不使用 Math.random）
      const logKey = (e) => (e && e.id ? String(e.id) : (e ? e.t + '|' + e.kind + '|' + (e.sessionId || '') + '|' + String(e.text || '').slice(0, 12) : 'x'))
      const spansOf = (t) => {
        const st = parseD(t.startDate) || parseD((t.createdAt || '').slice(0, 10)) || new Date()
        const en = t.dueDate ? (parseD(t.dueDate) || st) : st
        return { st, en }
      }
      const onDay = (t, day) => { const { st, en } = spansOf(t); return day >= dstr(st) && day <= dstr(en) }

      // ---------- 通用小组件（无状态叶子 memo 化，降低重渲染成本）----------
      const Badge = React.memo(function Badge({ text, color }) {
        return h('span', { className: 'tk-badge', style: { background: color + '26', color, borderColor: color } }, text)
      })
      const Stat = React.memo(function Stat({ label, value, warn, bad }) {
        return h('div', { className: 'tk-stat' },
          h('div', { className: 'tk-stat-v', style: { color: bad ? 'var(--dsw-alias-state-error-primary)' : warn ? 'var(--dsw-alias-state-warn-primary)' : undefined } }, String(value)),
          h('div', { className: 'tk-stat-l' }, label))
      })
      const Field = React.memo(function Field({ label, children }) {
        return h('label', { className: 'tk-field' }, h('span', { className: 'tk-field-label' }, label), children)
      })
      function Modal({ title, onClose, children, width }) {
        const cardRef = React.useRef(null)
        React.useEffect(() => {
          // Esc 关闭 + 打开时聚焦弹窗（键盘用户焦点不会逃到页面背景）
          if (typeof window !== 'undefined') {
            const onKey = (e) => { if (e.key === 'Escape') onClose() }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }
        }, [onClose])
        React.useEffect(() => { if (cardRef.current) cardRef.current.focus() }, [])
        return h('div', { className: 'tk-modal', role: 'presentation', onClick: (e) => { if (e.target === e.currentTarget) onClose() } },
          h('div', { className: 'tk-modal-card', ref: cardRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': String(title || ''), tabIndex: -1, style: width ? { width } : undefined },
            h('div', { className: 'tk-row', style: { justifyContent: 'space-between', marginBottom: 12 } },
              h('span', { className: 'tk-modal-title' }, title),
              h('button', { className: 'tk-btn ghost', onClick: onClose }, '✕')),
            children))
      }
      const LogRow = React.memo(function LogRow({ e }) {
        const label = KIND_LABEL[e.kind] || e.kind
        const tm = (e.t || '').slice(11, 16)
        return h('div', { className: 'tk-log' },
          h('span', { className: 'tk-log-t' }, (e.l || '') + ' ' + tm),
          h('span', { className: 'tk-log-k' }, label),
          h('span', { className: 'tk-log-x' }, e.text))
      })
      const Skeleton = React.memo(function Skeleton() {
        return h('div', { className: 'tk-skel' },
          h('div', { className: 'tk-skel-bar', style: { width: '38%' } }),
          h('div', { className: 'tk-skel-bar', style: { width: '64%' } }),
          h('div', { className: 'tk-skel-bar', style: { width: '52%' } }),
          h('div', { className: 'tk-skel-label' }, '加载中…'))
      })

      // ---------- 图标 ----------
      // 线性图标（feather 风格），随主题色
      const Ic = React.memo(function Ic({ paths, size = 16 }) {
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block', flex: 'none' } },
          (paths || []).map((d, i) => h('path', { key: i, d })))
      })
      const IC = {
        refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
        close: ['M18 6 6 18', 'm6 6 12 12'],
        maximize: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
        minimize: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
        popout: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
        calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
      }
      // Cindy 专属 Logo：品牌渐变圆角底 + 「知性女生」徽记
      //（圆脸 + 发髻 + 眼镜 = 知性；头顶灵感星芒 = 有能力；肩线收尾，简洁耐看）
      const CindyLogo = React.memo(function CindyLogo({ size = 20 }) {
        const uid = (React.useId ? React.useId() : 'x').replace(/[^a-zA-Z0-9]/g, '')
        const gid = 'cindy-g-' + uid
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', style: { display: 'block', flex: 'none' } },
          h('defs', null,
            h('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '1' },
              h('stop', { offset: '0', stopColor: 'var(--dsw-alias-brand-primary, #38bdf8)' }),
              h('stop', { offset: '1', stopColor: '#7c6cf0' }))),
          h('rect', { x: '1', y: '1', width: '22', height: '22', rx: '6.5', fill: 'url(#' + gid + ')' }),
          // 灵感星芒（左上）
          h('path', { d: 'M5.3 2.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z', fill: '#fff' }),
          // 发髻（右后侧）
          h('circle', { cx: '15.2', cy: '4.7', r: '1.45', fill: '#fff' }),
          // 头部（圆脸）
          h('circle', { cx: '12', cy: '8.5', r: '3.05', fill: '#fff' }),
          // 眼镜（知性）
          h('circle', { cx: '10.65', cy: '8.8', r: '1.1', fill: 'none', stroke: 'rgba(20,28,46,.8)', strokeWidth: '1' }),
          h('circle', { cx: '13.35', cy: '8.8', r: '1.1', fill: 'none', stroke: 'rgba(20,28,46,.8)', strokeWidth: '1' }),
          h('path', { d: 'M11.75 8.8h.5', stroke: 'rgba(20,28,46,.8)', strokeWidth: '1', strokeLinecap: 'round' }),
          // 肩线（收尾）
          h('path', { d: 'M5.1 21.2c0-3.9 3.2-6.5 6.9-6.5s6.9 2.6 6.9 6.5z', fill: '#fff' }))
      })

      // ---------- 总览（管理面板）----------
      function TaskCard({ t, state, sessionsByTask }) {
        useStore()
        const p = state.products.find((x) => x.id === t.productId)
        const sc = STAGE_COLORS[t.stage] || '#94a3b8'
        const pc = PRI_COLORS[t.priority] || '#94a3b8'
        const today = todayStr()
        const overdue = t.dueDate && t.dueDate < today && t.stage !== '已关闭'
        const dueToday = t.dueDate === today && t.stage !== '已关闭'
        const sCount = sessionsByTask ? (sessionsByTask[t.id] || 0) : 0
        return h('div', { className: 'tk-card', onClick: () => store.set({ detailTaskId: t.id }) },
          h('div', { className: 'tk-row', style: { justifyContent: 'space-between', flexWrap: 'nowrap' } },
            h('span', { className: 'tk-card-name', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
            h(Badge, { text: (STAGE_ICON[t.stage] || '') + t.stage, color: sc })),
          h('div', { className: 'tk-row', style: { gap: 6, marginTop: 5 } },
            h(Badge, { text: t.priority, color: pc }),
            p ? h('span', { className: 'tk-dim', style: { fontSize: 11 } }, p.name) : null,
            sCount > 0 ? h('span', { className: 'tk-dim', style: { fontSize: 11 } }, '💬' + sCount) : null),
          h('div', { className: 'tk-row', style: { gap: 6, marginTop: 6 } },
            h('span', { className: 'tk-dim', style: { fontSize: 11 } }, (t.startDate || '') + ' → ' + (t.dueDate || '未定')),
            overdue ? h('span', { className: 'tk-dim', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11, fontWeight: 600 } }, '已逾期') : null,
            dueToday ? h('span', { className: 'tk-dim', style: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11, fontWeight: 600 } }, '今日到期') : null),
          h('div', { className: 'tk-prog', style: { marginTop: 9 } }, h('div', { style: { width: t.progress + '%' } })),
          h('div', { className: 'tk-dim', style: { fontSize: 10, marginTop: 3, textAlign: 'right' } }, t.progress + '%'))
      }

      function BoardTab({ state, sessionsByTask }) {
        useStore()
        const [group, setGroup] = React.useState('product')
        const [busy, setBusy] = React.useState(false)
        const st = state.stats || {}
        const today = todayStr()
        const open = state.tasks.filter((t) => t.stage !== '已关闭')
        const dueToday = open.filter((t) => t.dueDate === today)
        const overdue = open.filter((t) => t.dueDate && t.dueDate < today)
        const gen = async (kind) => {
          setBusy(true)
          try {
            await call('generate-report', { kind })
            await refresh()
          } catch (e) { store.set({ error: String(e.message || e) }) } finally { setBusy(false) }
        }
        return h('div', { className: 'tk-body' },
          h('div', { className: 'tk-row', style: { justifyContent: 'space-between' } },
            h('div', { className: 'tk-row', style: { gap: 10 } },
              h(Stat, { label: '任务总数', value: st.total || 0 }),
              h(Stat, { label: '进行中', value: st.active || 0 }),
              h(Stat, { label: '今日到期', value: dueToday.length, warn: dueToday.length > 0 }),
              h(Stat, { label: '已逾期', value: overdue.length, bad: overdue.length > 0 }),
              h(Stat, { label: '会话关联', value: st.sessionLinks || 0 })),
            h('div', { className: 'tk-row' },
              h('button', { className: 'tk-btn primary', disabled: busy, onClick: () => gen('daily') }, '📄 生成日报'),
              h('button', { className: 'tk-btn', disabled: busy, onClick: () => gen('weekly') }, '📊 生成周报'),
              h('button', { className: 'tk-btn ghost', title: '刷新', onClick: () => refresh() }, '↻'))),
          h('div', { className: 'tk-row', style: { justifyContent: 'space-between' } },
            h('div', { className: 'tk-row' },
              h('button', { className: 'tk-btn' + (group === 'product' ? ' primary' : ''), onClick: () => setGroup('product') }, '按产品'),
              h('button', { className: 'tk-btn' + (group === 'stage' ? ' primary' : ''), onClick: () => setGroup('stage') }, '按阶段')),
            state.products.length === 0
              ? h('span', { className: 'tk-dim', style: { fontSize: 12 } }, '先在「设置」中创建产品')
              : h('button', { className: 'tk-btn primary', onClick: () => store.set({ newTaskProductId: state.products[0].id }) }, '＋ 新建任务')),
          group === 'product'
            ? h('div', { className: 'tk-cols' }, state.products.map((p) => {
                const list = state.tasks.filter((t) => t.productId === p.id)
                return h('div', { className: 'tk-col', key: p.id },
                  h('div', { className: 'tk-col-head' },
                    h('span', { className: 'tk-col-title' }, '📦 ' + p.name + '（' + list.length + '）'),
                    h('button', { className: 'tk-btn ghost', style: { padding: '2px 8px' }, onClick: () => store.set({ newTaskProductId: p.id }) }, '＋')),
                  list.length === 0 ? h('div', { className: 'tk-empty' }, '暂无任务') : null,
                  list.map((t) => h(TaskCard, { key: t.id, t, state, sessionsByTask })))
              }))
            : h('div', { className: 'tk-cols' }, (state.config.stages || []).map((stg) => {
                const list = state.tasks.filter((t) => t.stage === stg)
                return h('div', { className: 'tk-col', key: stg },
                  h('div', { className: 'tk-col-head' },
                    h('span', { className: 'tk-col-title', style: { color: STAGE_COLORS[stg] || '#94a3b8' } }, (STAGE_ICON[stg] || '') + stg + '（' + list.length + '）')),
                  list.length === 0 ? h('div', { className: 'tk-empty' }, '暂无') : null,
                  list.map((t) => h(TaskCard, { key: t.id, t, state, sessionsByTask })))
              })))
      }

      // ---------- 新建任务 ----------
      function TaskForm({ state }) {
        useStore()
        const [name, setName] = React.useState('')
        const [tplId, setTplId] = React.useState(state.templates.length ? state.templates[0].id : '')
        const [productId, setProductId] = React.useState(store.newTaskProductId || (state.products[0] && state.products[0].id) || '')
        const [start, setStart] = React.useState(todayStr())
        const [due, setDue] = React.useState('')
        const [pri, setPri] = React.useState('中')
        const [note, setNote] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        const submit = async () => {
          setBusy(true); setErr(null)
          try {
            await call('create-task', { productId, name, templateId: tplId, startDate: start, dueDate: due || '', priority: pri, note })
            store.set({ newTaskProductId: null })
            await refresh()
          } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        return h(Modal, { title: '新建任务', onClose: () => store.set({ newTaskProductId: null }) },
          h('div', { className: 'tk-grid2' },
            h(Field, { label: '产品' }, h('select', { className: 'tk-input', value: productId, onChange: (e) => setProductId(e.target.value) },
              state.products.map((p) => h('option', { key: p.id, value: p.id }, p.name)))),
            h(Field, { label: '任务名（将作为文件夹名）' }, h('input', { className: 'tk-input', placeholder: '如：性能比测', value: name, onChange: (e) => setName(e.target.value), autoFocus: true })),
            h(Field, { label: '文件夹模板' }, h('select', { className: 'tk-input', value: tplId, onChange: (e) => setTplId(e.target.value) },
              state.templates.map((t) => h('option', { key: t.id, value: t.id }, t.name)))),
            h(Field, { label: '优先级' }, h('select', { className: 'tk-input', value: pri, onChange: (e) => setPri(e.target.value) },
              ['高', '中', '低'].map((x) => h('option', { key: x, value: x }, x)))),
            h(Field, { label: '开始日期' }, h('input', { className: 'tk-input', type: 'date', value: start, onChange: (e) => setStart(e.target.value) })),
            h(Field, { label: '截止日期' }, h('input', { className: 'tk-input', type: 'date', value: due, onChange: (e) => setDue(e.target.value) }))),
          h(Field, { label: '备注' }, h('textarea', { className: 'tk-input', rows: 2, value: note, onChange: (e) => setNote(e.target.value) })),
          h('div', { className: 'tk-dim', style: { fontSize: 11, marginBottom: 8 } }, '创建后自动生成目录结构并注册为 harness 工作区，之后针对该任务的会话直接在任务文件夹中工作。'),
          err ? h('div', { className: 'tk-err', style: { marginBottom: 8 } }, err) : null,
          h('div', { className: 'tk-row' },
            h('button', { className: 'tk-btn primary', disabled: busy || !name.trim(), onClick: submit }, '创建任务'),
            h('button', { className: 'tk-btn ghost', onClick: () => store.set({ newTaskProductId: null }) }, '取消')))
      }

      // ---------- 任务详情 ----------
      function TaskDetail({ state, sessionsByTask }) {
        useStore()
        const t = state.tasks.find((x) => x.id === store.detailTaskId)
        const [stage, setStage] = React.useState('')
        const [progress, setProgress] = React.useState(0)
        const [pri, setPri] = React.useState('中')
        const [start, setStart] = React.useState('')
        const [due, setDue] = React.useState('')
        const [note, setNote] = React.useState('')
        const [logText, setLogText] = React.useState('')
        const [logs, setLogs] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [confirmDel, setConfirmDel] = React.useState(false)
        const [err, setErr] = React.useState(null)
        React.useEffect(() => {
          if (!t) return
          setStage(t.stage); setProgress(t.progress); setPri(t.priority)
          setStart(t.startDate || ''); setDue(t.dueDate || ''); setNote(t.note || '')
          setLogs(null); setConfirmDel(false); setErr(null)
          call('get-journal', { taskId: t.id, limit: 100 }).then((r) => setLogs(r.entries)).catch(() => setLogs([]))
        }, [t && t.id])
        if (!t) return null
        const p = state.products.find((x) => x.id === t.productId)
        const sessList = sessionsByTask ? (sessionsByTask[t.id] || []) : []
        const save = async () => {
          setBusy(true); setErr(null)
          try {
            await call('update-task', { id: t.id, patch: { stage, progress: Number(progress), priority: pri, startDate: start, dueDate: due, note } })
            await refresh()
          } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const addLog = async () => {
          if (!logText.trim()) return
          setBusy(true)
          try {
            await call('add-log', { taskId: t.id, text: logText })
            setLogText('')
            const r = await call('get-journal', { taskId: t.id, limit: 100 })
            setLogs(r.entries)
          } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const del = async () => {
          if (!confirmDel) { setConfirmDel(true); return }
          setBusy(true)
          try {
            await call('delete-task', { id: t.id })
            store.set({ detailTaskId: null })
            await refresh()
          } catch (e) { setErr(String(e.message || e)); setBusy(false) }
        }
        const openWs = async () => {
          if (!wsSvc || !t.workspaceId) return
          try { await wsSvc.connectWorkspace(t.workspaceId) } catch (e) { setErr(String(e.message || e)) }
        }
        const openFolder = async () => {
          if (!wsSvc) return
          try { await wsSvc.openPath(t.folder) } catch (e) { setErr(String(e.message || e)) }
        }
        return h(Modal, { title: '任务详情', onClose: () => store.set({ detailTaskId: null }), width: 780 },
          h('div', { className: 'tk-detail-head' },
            h('div', null,
              h('div', { className: 'tk-modal-title' }, t.name),
              p ? h('div', { className: 'tk-dim', style: { fontSize: 12, marginTop: 2 } }, '📦 ' + p.name + ' · 📁 ' + t.folder) : null),
            h('div', { className: 'tk-row' },
              t.workspaceId && wsSvc ? h('button', { className: 'tk-btn', onClick: openWs }, '💬 打开工作区会话') : null,
              wsSvc ? h('button', { className: 'tk-btn ghost', onClick: openFolder }, '📂 打开文件夹') : null)),
          h('div', { className: 'tk-grid2' },
            h(Field, { label: '阶段' }, h('select', { className: 'tk-input', value: stage, onChange: (e) => setStage(e.target.value) },
              (state.config.stages || []).map((st) => h('option', { key: st, value: st }, st)))),
            h(Field, { label: '优先级' }, h('select', { className: 'tk-input', value: pri, onChange: (e) => setPri(e.target.value) },
              ['高', '中', '低'].map((x) => h('option', { key: x, value: x }, x)))),
            h(Field, { label: '开始日期' }, h('input', { className: 'tk-input', type: 'date', value: start, onChange: (e) => setStart(e.target.value) })),
            h(Field, { label: '截止日期' }, h('input', { className: 'tk-input', type: 'date', value: due, onChange: (e) => setDue(e.target.value) })),
            h(Field, { label: '进度 ' + progress + '%' }, h('input', { type: 'range', min: 0, max: 100, value: progress, onChange: (e) => setProgress(Number(e.target.value)) }))),
          h(Field, { label: '备注' }, h('textarea', { className: 'tk-input', rows: 2, value: note, onChange: (e) => setNote(e.target.value) })),
          err ? h('div', { className: 'tk-err', style: { marginBottom: 8 } }, err) : null,
          h('div', { className: 'tk-row' },
            h('button', { className: 'tk-btn primary', disabled: busy, onClick: save }, '保存'),
            h('button', { className: 'tk-btn' + (confirmDel ? ' danger' : ''), onClick: del }, confirmDel ? '再点一次确认删除' : '删除任务'),
            h('span', { className: 'tk-dim', style: { marginLeft: 'auto', fontSize: 11 } }, '工作区：' + (t.workspaceId ? String(t.workspaceId).slice(0, 8) + '…' : '未注册'))),
          sessList.length ? h('div', null,
            h('div', { className: 'tk-sec' }, '关联会话（' + sessList.length + '）'),
            sessList.map((x) => h('div', { className: 'tk-log', key: x.id }, '💬 ' + (x.title || x.id)))) : null,
          h('div', { className: 'tk-sec' }, '进度记录'),
          h('div', { className: 'tk-row' },
            h('input', { className: 'tk-input', style: { flex: 1 }, placeholder: '记录一条进展…', value: logText, onChange: (e) => setLogText(e.target.value) }),
            h('button', { className: 'tk-btn primary', disabled: busy || !logText.trim(), onClick: addLog }, '添加')),
          h('div', { className: 'tk-logs' },
            logs === null ? h('div', { className: 'tk-dim' }, '加载中…')
            : logs.length === 0 ? h('div', { className: 'tk-dim' }, '暂无记录')
            : logs.map((e) => h(LogRow, { key: logKey(e), e }))))
      }

      // ---------- 日历 ----------
      function calTitle(view, cursor) {
        if (view === 'day') return cursor.getFullYear() + '年' + (cursor.getMonth() + 1) + '月' + cursor.getDate() + '日'
        if (view === 'week') {
          const mon = addD(cursor, -((cursor.getDay() + 6) % 7))
          return mon.getFullYear() + '年' + (mon.getMonth() + 1) + '月' + mon.getDate() + '日 当周'
        }
        return cursor.getFullYear() + '年' + (cursor.getMonth() + 1) + '月'
      }

      function CalendarTab({ state }) {
        useStore()
        const view = store.calView || 'month'
        const cursor = store.calCursor ? (parseD(store.calCursor) || new Date()) : new Date()
        const today = todayStr()
        const setView = (v) => store.set({ calView: v })
        const move = (n) => {
          if (view === 'month') store.set({ calCursor: dstr(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1)) })
          else store.set({ calCursor: dstr(addD(cursor, n * (view === 'week' ? 7 : 1))) })
        }
        const chip = (t) => {
          const sc = STAGE_COLORS[t.stage] || '#94a3b8'
          return h('div', { className: 'tk-evt', key: t.id, style: { borderLeftColor: sc }, title: t.name + '（' + t.stage + '）', onClick: () => store.set({ detailTaskId: t.id }) },
            h('span', { style: { color: sc } }, '● '), t.name)
        }
        const head = h('div', { className: 'tk-row', style: { justifyContent: 'space-between' } },
          h('div', { className: 'tk-row' },
            h('button', { className: 'tk-btn ghost', onClick: () => move(-1) }, '‹'),
            h('span', { className: 'tk-cal-title' }, calTitle(view, cursor)),
            h('button', { className: 'tk-btn ghost', onClick: () => move(1) }, '›'),
            h('button', { className: 'tk-btn ghost', onClick: () => store.set({ calCursor: null }) }, '今天')),
          h('div', { className: 'tk-row' },
            [['day', '日'], ['week', '周'], ['month', '月']].map((v) => h('button', { key: v[0], className: 'tk-btn' + (view === v[0] ? ' primary' : ''), onClick: () => setView(v[0]) }, v[1]))))
        if (view === 'day') {
          const day = dstr(cursor)
          const list = state.tasks.filter((t) => onDay(t, day))
          const entries = (state.journalTail || []).filter((e) => e.l === day)
          return h('div', { className: 'tk-body' }, head,
            h('div', { className: 'tk-sec' }, day + ' 任务（' + list.length + '）'),
            list.length ? list.map(chip) : h('div', { className: 'tk-empty' }, '当日无任务'),
            h('div', { className: 'tk-sec' }, '当日记录'),
            entries.length ? entries.map((e) => h(LogRow, { key: logKey(e), e })) : h('div', { className: 'tk-empty' }, '无记录'))
        }
        if (view === 'week') {
          const mon = addD(cursor, -((cursor.getDay() + 6) % 7))
          const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addD(mon, i))
          return h('div', { className: 'tk-body' }, head,
            h('div', { className: 'tk-cal-week' }, days.map((d) => {
              const ds = dstr(d)
              const list = state.tasks.filter((t) => onDay(t, ds))
              return h('div', { className: 'tk-cal-cell' + (ds === today ? ' today' : ''), key: ds },
                h('div', { className: 'tk-cal-dayhead', style: { color: ds === today ? 'var(--dsw-alias-brand-primary)' : undefined } }, WEEK[(d.getDay() + 6) % 7] + ' ' + pad(d.getDate())),
                list.map(chip))
            })))
        }
        const y = cursor.getFullYear()
        const m = cursor.getMonth()
        const first = new Date(y, m, 1)
        const offset = (first.getDay() + 6) % 7
        const start = addD(first, -offset)
        const cells = []
        for (let i = 0; i < 42; i++) cells.push(addD(start, i))
        return h('div', { className: 'tk-body' }, head,
          h('div', { className: 'tk-cal-head' }, WEEK.map((w) => h('div', { key: w, className: 'tk-cal-wh' }, w))),
          h('div', { className: 'tk-cal' }, cells.map((d) => {
            const ds = dstr(d)
            const inM = d.getMonth() === m
            const list = state.tasks.filter((t) => onDay(t, ds))
            return h('div', {
              className: 'tk-cal-cell' + (inM ? '' : ' other') + (ds === today ? ' today' : ''),
              key: ds,
              onClick: (e) => { if (e.target === e.currentTarget) store.set({ calView: 'day', calCursor: ds }) },
            },
            h('div', { className: 'tk-cal-dayhead' }, pad(d.getDate())),
            list.slice(0, 4).map(chip),
            list.length > 4 ? h('div', { className: 'tk-more', title: '查看当天全部任务', onClick: (e) => { e.stopPropagation(); store.set({ calView: 'day', calCursor: ds }) } }, '+' + (list.length - 4) + ' 更多') : null)
          })))
      }

      // ---------- 甘特图 ----------
      function GanttTab({ state }) {
        useStore()
        const tasks = state.tasks.slice().sort((a, b) => ((a.startDate || '9999') < (b.startDate || '9999') ? -1 : 1))
        const today = todayStr()
        let minS = today
        let maxE = today
        for (const t of tasks) {
          const { st, en } = spansOf(t)
          const a = dstr(st)
          const b = dstr(en)
          if (a < minS) minS = a
          if (b > maxE) maxE = b
        }
        const minD = parseD(minS)
        const maxD = parseD(maxE)
        const diffDays = Math.max(0, Math.round((maxD.getTime() - minD.getTime()) / 86400000))
        const dayScale = diffDays <= 45
        const colW = dayScale ? 30 : 96
        const nCols = dayScale ? diffDays + 1 : Math.ceil((diffDays + 1) / 7)
        const idxOf = (ds) => {
          const d = parseD(ds)
          const off = Math.max(0, Math.round((d.getTime() - minD.getTime()) / 86400000))
          return dayScale ? off : Math.floor(off / 7)
        }
        const labels = []
        for (let i = 0; i < nCols; i++) {
          const d = addD(minD, dayScale ? i : i * 7)
          labels.push(dayScale ? (d.getDate() === 1 ? (d.getMonth() + 1) + '月' : String(d.getDate())) : 'W' + Math.ceil((d.getDate() - d.getDay() + 6) / 7) + '·' + (d.getMonth() + 1) + '/' + d.getDate())
        }
        const todayIdx = idxOf(today)
        const grouped = {}
        for (const t of tasks) { (grouped[t.productId] = grouped[t.productId] || []).push(t) }
        const pname = (id) => { const p = state.products.find((x) => x.id === id); return p ? p.name : '未分组' }
        const bar = (t) => {
          const { st, en } = spansOf(t)
          const i0 = idxOf(dstr(st))
          const i1 = idxOf(dstr(en))
          const left = i0 * colW
          const width = Math.max(colW - 4, (i1 - i0 + 1) * colW - 4)
          const sc = STAGE_COLORS[t.stage] || '#94a3b8'
          return h('div', {
            className: 'tk-g-bar', title: t.name + '（' + t.stage + ' · ' + t.progress + '%）',
            onClick: () => store.set({ detailTaskId: t.id }),
            style: { left, width, background: 'linear-gradient(90deg, ' + sc + 'dd, ' + sc + '99)', border: '1px solid ' + sc },
          }, width > 70 ? h('span', { className: 'tk-g-bar-label' }, t.name) : null)
        }
        return h('div', { className: 'tk-body' },
          h('div', { className: 'tk-dim', style: { fontSize: 11 } }, '共 ' + tasks.length + ' 个任务 · 区间 ' + minS + ' ~ ' + maxE + '（' + (dayScale ? '日视图' : '周视图') + '）· 点击色条查看任务详情'),
          h('div', { className: 'tk-gantt' },
            h('div', { className: 'tk-gantt-inner', style: { width: 220 + nCols * colW } },
              h('div', { className: 'tk-g-row', style: { position: 'sticky', top: 0, zIndex: 3, background: 'var(--dsw-alias-bg-overlay)' } },
                h('div', { className: 'tk-g-label' }, '任务'),
                h('div', { style: { position: 'relative', width: nCols * colW, height: 22 } },
                  labels.map((lb, i) => h('div', { key: i, className: 'tk-g-h', style: { left: i * colW, width: colW } }, lb)),
                  h('div', { className: 'tk-g-today', style: { left: todayIdx * colW } }))),
              Object.keys(grouped).map((pid) => h('div', { key: pid },
                h('div', { className: 'tk-g-row tk-g-group' }, h('div', { className: 'tk-g-label' }, '📦 ' + pname(pid))),
                grouped[pid].map((t) => h('div', { className: 'tk-g-row', key: t.id },
                  h('div', { className: 'tk-g-label', style: { paddingLeft: 16 } }, t.name),
                  h('div', { style: { position: 'relative', width: nCols * colW, height: 28 } },
                    h('div', { className: 'tk-g-grid' }, labels.map((lb, i) => h('i', { key: i, style: { left: i * colW } }))),
                    bar(t)))))))))
      }

      // ---------- 日志 ----------
      function JournalTab({ state }) {
        useStore()
        const [taskFilter, setTaskFilter] = React.useState('')
        const [kindFilter, setKindFilter] = React.useState('')
        const [entries, setEntries] = React.useState(null)
        const [logTask, setLogTask] = React.useState('')
        const [text, setText] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        const [viewing, setViewing] = React.useState(null)
        const load = () => call('get-journal', { limit: 500 }).then((r) => setEntries(r.entries)).catch(() => setEntries([]))
        React.useEffect(() => { load() }, [])
        const filtered = (entries || []).filter((e) => (!taskFilter || e.taskId === taskFilter) && (!kindFilter || e.kind === kindFilter))
        const gen = async (kind) => {
          setBusy(true)
          try {
            const r = await call('generate-report', { kind })
            setViewing({ title: (kind === 'daily' ? '日报 ' : '周报 ') + r.date, content: r.content })
            await refresh()
          } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const view = async (rep) => {
          try {
            const r = await call('read-report', { id: rep.id })
            setViewing({ title: rep.id, content: r.content })
          } catch (e) { setErr(String(e.message || e)) }
        }
        const add = async () => {
          if (!logTask || !text.trim()) return
          setBusy(true)
          try {
            await call('add-log', { taskId: logTask, text })
            setText('')
            await load()
          } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        return h('div', { className: 'tk-body' },
          h('div', { className: 'tk-row' },
            h('select', { className: 'tk-input', value: taskFilter, onChange: (e) => setTaskFilter(e.target.value) },
              h('option', { value: '' }, '全部任务'),
              state.tasks.map((t) => h('option', { key: t.id, value: t.id }, t.name))),
            h('select', { className: 'tk-input', value: kindFilter, onChange: (e) => setKindFilter(e.target.value) },
              h('option', { value: '' }, '全部类型'),
              Object.keys(KIND_LABEL).map((k) => h('option', { key: k, value: k }, KIND_LABEL[k]))),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'tk-btn primary', disabled: busy, onClick: () => gen('daily') }, '📄 生成日报'),
            h('button', { className: 'tk-btn', disabled: busy, onClick: () => gen('weekly') }, '📊 生成周报')),
          err ? h('div', { className: 'tk-err' }, err) : null,
          h('div', { className: 'tk-sec' }, '添加进度记录'),
          h('div', { className: 'tk-row' },
            h('select', { className: 'tk-input', value: logTask, onChange: (e) => setLogTask(e.target.value) },
              h('option', { value: '' }, '选择任务…'),
              state.tasks.map((t) => h('option', { key: t.id, value: t.id }, t.name))),
            h('input', { className: 'tk-input', style: { flex: 1 }, placeholder: '输入进展内容…', value: text, onChange: (e) => setText(e.target.value) }),
            h('button', { className: 'tk-btn primary', disabled: busy || !logTask || !text.trim(), onClick: add }, '记录')),
          h('div', { className: 'tk-sec' }, '活动日志（' + filtered.length + '）'),
          h('div', { className: 'tk-logs', style: { maxHeight: 260 } },
            entries === null ? h('div', { className: 'tk-dim' }, '加载中…')
            : filtered.length === 0 ? h('div', { className: 'tk-empty' }, '暂无记录')
            : filtered.map((e) => h(LogRow, { key: logKey(e), e }))),
          h('div', { className: 'tk-sec' }, '报告（' + (state.reports || []).length + '）'),
          h('div', { className: 'tk-grid', style: { maxHeight: 220, overflow: 'auto' } },
            (state.reports || []).slice(0, 40).map((r) => h('div', { className: 'tk-card', key: r.id, onClick: () => view(r) },
              h('div', { className: 'tk-card-name' }, (r.kind === 'daily' ? '📄 ' : '📊 ') + r.id),
              h('div', { className: 'tk-dim', style: { fontSize: 11 } }, r.kind === 'daily' ? '每日总结' : '周报')))),
          viewing ? h(Modal, { title: viewing.title, onClose: () => setViewing(null), width: 820 },
            h('pre', { className: 'tk-pre' }, viewing.content)) : null)
      }

      // ---------- 设置 ----------
      function SettingsTab({ state }) {
        useStore()
        const [pathInput, setPathInput] = React.useState(state.config ? state.config.root : '')
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        const [pName, setPName] = React.useState('')
        const [pNote, setPNote] = React.useState('')
        const [tplEdit, setTplEdit] = React.useState(null)
        const [dTime, setDTime] = React.useState(state.config ? state.config.dailyTime : '18:00')
        const [wDay, setWDay] = React.useState(state.config ? String(state.config.weeklyDay) : '1')
        const applyRoot = async (p) => {
          setBusy(true); setErr(null)
          try { await call('set-root', { path: p }); setPathInput(p); await refresh() } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const pick = async () => {
          if (!wsSvc || !wsSvc.pickDirectory) { setErr('当前客户端不支持目录选择，请手动输入路径'); return }
          try { const p = await wsSvc.pickDirectory(); if (p) await applyRoot(p) } catch (e) { setErr(String(e.message || e)) }
        }
        const addProduct = async () => {
          if (!pName.trim()) return
          setBusy(true); setErr(null)
          try { await call('create-product', { name: pName, note: pNote }); setPName(''); setPNote(''); await refresh() } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const delProduct = async (id) => {
          setBusy(true); setErr(null)
          try { await call('delete-product', { id }); await refresh() } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const delTpl = async (id) => {
          setBusy(true); setErr(null)
          try { await call('delete-template', { id }); await refresh() } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const saveTpl = async () => {
          if (!tplEdit || !tplEdit.name.trim() || !tplEdit.itemsText.trim()) return
          setBusy(true); setErr(null)
          try {
            const items = String(tplEdit.itemsText).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
              const i = l.indexOf('|')
              return i >= 0 ? { path: l.slice(0, i).trim(), desc: l.slice(i + 1).trim() } : { path: l }
            })
            if (tplEdit.id) await call('update-template', { id: tplEdit.id, name: tplEdit.name, items, note: tplEdit.note })
            else await call('create-template', { name: tplEdit.name, items, note: tplEdit.note })
            setTplEdit(null)
            await refresh()
          } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const saveSched = async () => {
          setBusy(true); setErr(null)
          try { await call('set-config', { dailyTime: dTime, weeklyDay: Number(wDay) }); await refresh() } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const itemsText = (t) => (t.items || []).map((it) => it.path + (it.desc ? '|' + it.desc : '')).join('\n')
        const secCard = (title, ...children) => h('div', { className: 'tk-sec-card' },
          h('div', { className: 'tk-sec' }, title), ...children)
        return h('div', { className: 'tk-body' },
          secCard('根目录',
            state.config ? h('div', { className: 'tk-row' }, h('span', { className: 'tk-dim', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '📁 ' + state.config.root)) : null,
            h('div', { className: 'tk-row' },
              h('input', { className: 'tk-input', style: { flex: 1 }, placeholder: '输入总目录绝对路径，如 D:\\Work', value: pathInput, onChange: (e) => setPathInput(e.target.value) }),
              h('button', { className: 'tk-btn', disabled: busy, onClick: pick }, '📂 浏览…'),
              h('button', { className: 'tk-btn primary', disabled: busy || !pathInput.trim(), onClick: () => applyRoot(pathInput) }, state.config ? '切换根目录' : '启用')),
            h('div', { className: 'tk-hint' }, '管理数据保存在该目录下 .taskman/ 中（可随目录迁移、可 git 追踪）；产品与任务文件夹直接建在该目录下。')),
          err ? h('div', { className: 'tk-err' }, err) : null,
          secCard('产品管理',
            h('div', { className: 'tk-row' },
              h('input', { className: 'tk-input', style: { width: 200 }, placeholder: '产品名，如 B300雷达', value: pName, onChange: (e) => setPName(e.target.value) }),
              h('input', { className: 'tk-input', style: { flex: 1 }, placeholder: '备注（可选）', value: pNote, onChange: (e) => setPNote(e.target.value) }),
              h('button', { className: 'tk-btn primary', disabled: busy || !pName.trim(), onClick: addProduct }, '＋ 添加')),
            state.products.length === 0
              ? h('div', { className: 'tk-empty' }, '暂无产品，先创建一个吧')
              : h('div', { className: 'tk-grid' }, state.products.map((p) => h('div', { className: 'tk-card', key: p.id, style: { cursor: 'default' } },
                  h('div', { className: 'tk-row', style: { justifyContent: 'space-between', flexWrap: 'nowrap' } },
                    h('span', { className: 'tk-card-name', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '📦 ' + p.name),
                    h('button', { className: 'tk-btn danger', style: { padding: '3px 8px', flex: 'none' }, disabled: busy, onClick: () => delProduct(p.id) }, '删除')),
                  p.note ? h('div', { className: 'tk-dim', style: { fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.note) : null)))),
          secCard('文件夹模板（新建任务时一键生成目录结构）',
            state.templates.length === 0
              ? h('div', { className: 'tk-empty' }, '暂无模板')
              : h('div', { className: 'tk-grid' }, state.templates.map((t) => h('div', { className: 'tk-card', key: t.id, style: { cursor: 'default' } },
                  h('div', { className: 'tk-row', style: { justifyContent: 'space-between', flexWrap: 'nowrap' } },
                    h('span', { className: 'tk-card-name', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '🗂 ' + t.name + (t.builtin ? '（内置）' : '')),
                    h('div', { className: 'tk-row', style: { flexWrap: 'nowrap', flex: 'none' } },
                      h('button', { className: 'tk-btn ghost', style: { padding: '3px 8px' }, onClick: () => setTplEdit({ id: t.id, name: t.name, itemsText: itemsText(t), note: t.note || '' }) }, '编辑'),
                      !t.builtin ? h('button', { className: 'tk-btn danger', style: { padding: '3px 8px' }, disabled: busy, onClick: () => delTpl(t.id) }, '删除') : null)),
                  h('div', { className: 'tk-dim', style: { fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (t.items || []).map((it) => it.path).join(' / '))))),
            h('button', { className: 'tk-btn', style: { alignSelf: 'flex-start' }, disabled: busy, onClick: () => setTplEdit({ id: null, name: '', itemsText: 'script|存放脚本\ndata|存放数据\noutput|代码输出的文件\noutcome|任务成果、结论\nreference|参考文档\nproject|项目简介、会议记录和进程', note: '' }) }, '＋ 新建模板')),
          secCard('日程与自动化',
            h('div', { className: 'tk-row' },
              h(Field, { label: '每日总结时间' }, h('input', { className: 'tk-input', type: 'time', value: dTime, onChange: (e) => setDTime(e.target.value) })),
              h(Field, { label: '周报生成日' }, h('select', { className: 'tk-input', value: wDay, onChange: (e) => setWDay(e.target.value) },
                [['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六'], ['7', '周日']].map((x) => h('option', { key: x[0], value: x[0] }, x[1])))),
              h('button', { className: 'tk-btn primary', disabled: busy, onClick: saveSched }, '保存')),
            h('div', { className: 'tk-hint' }, '到达设定时间后每 5 分钟检查一次：自动生成当日总结；到周报日后自动生成本周周报。报告为 Markdown，保存在根目录 .taskman/reports/。任务会话中的文件操作与启动/结束会通过 harness 事件自动写入日志。')),
          tplEdit ? h(Modal, { title: tplEdit.id ? '编辑模板' : '新建模板', onClose: () => setTplEdit(null), width: 620 },
            h(Field, { label: '模板名' }, h('input', { className: 'tk-input', value: tplEdit.name, onChange: (e) => setTplEdit({ ...tplEdit, name: e.target.value }) })),
            h(Field, { label: '文件夹结构（每行一个；用 | 追加说明；支持嵌套路径如 docs/meeting）' }, h('textarea', { className: 'tk-input', rows: 8, value: tplEdit.itemsText, onChange: (e) => setTplEdit({ ...tplEdit, itemsText: e.target.value }) })),
            h(Field, { label: '备注' }, h('input', { className: 'tk-input', value: tplEdit.note, onChange: (e) => setTplEdit({ ...tplEdit, note: e.target.value }) })),
            h('div', { className: 'tk-row' },
              h('button', { className: 'tk-btn primary', disabled: busy, onClick: saveTpl }, '保存'),
              h('button', { className: 'tk-btn ghost', onClick: () => setTplEdit(null) }, '取消'))) : null)
      }

      // ---------- 初始化引导 ----------
      function Onboard() {
        useStore()
        const [p, setP] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        const apply = async (path) => {
          setBusy(true); setErr(null)
          try { await call('set-root', { path }); setP(path); await refresh() } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
        }
        const pick = async () => {
          if (!wsSvc || !wsSvc.pickDirectory) { setErr('当前客户端不支持目录选择，请手动输入路径'); return }
          try { const x = await wsSvc.pickDirectory(); if (x) await apply(x) } catch (e) { setErr(String(e.message || e)) }
        }
        return h('div', { className: 'tk-body' },
          h('div', { className: 'tk-hero', style: { display: 'flex', justifyContent: 'center' } }, h(CindyLogo, { size: 64 })),
          h('div', { className: 'tk-quick-title', style: { textAlign: 'center' } }, '欢迎使用 Cindy 任务秘书'),
          h('div', { className: 'tk-dim', style: { textAlign: 'center' } }, '第一步：选择一个总目录。所有产品文件夹、任务文件夹与管理数据（.taskman/）都将存放于此。'),
          h('div', { className: 'tk-row', style: { justifyContent: 'center', marginTop: 4 } },
            h('input', { className: 'tk-input', style: { flex: 1, maxWidth: 420 }, placeholder: '如 D:\\Work 或 /home/me/work', value: p, onChange: (e) => setP(e.target.value) }),
            h('button', { className: 'tk-btn', disabled: busy, onClick: pick }, '📂 浏览…'),
            h('button', { className: 'tk-btn primary', disabled: busy || !p.trim(), onClick: () => apply(p) }, '启用')),
          err ? h('div', { className: 'tk-err', style: { textAlign: 'center' } }, err) : null,
          h('div', { className: 'tk-dim', style: { fontSize: 11, marginTop: 10, textAlign: 'center' } }, '启用后自动创建内置模板：script / data / output / outcome / reference / project。'))
      }

      // ---------- 主面板 ----------
      function Panel() {
        useStore()
        const [drag, setDrag] = React.useState(null)
        const [resize, setResize] = React.useState(null)
        React.useEffect(() => {
          refresh()
          let disp = null
          if (timer) disp = timer.interval(() => { refresh() }, 30000)
          return () => { if (disp) disp() }
        }, [])
        if (!store.open) return null
        const pos = store.pos
        const size = store.size || { w: 980, h: 660 }
        const fs = store.fullscreen
        // 全屏：占满整个视口；普通：可拖动、可缩放、窄屏夹紧
        const style = fs
          ? { zIndex: 400, inset: 0, width: '100vw', height: '100vh', borderRadius: 0, border: 'none' }
          : {
              zIndex: 400, pointerEvents: 'auto',
              width: size.w, maxWidth: 'calc(100vw - 24px)',
              height: size.h, maxHeight: 'calc(100vh - 24px)',
              top: pos ? Math.max(8, pos.y) : 72,
              left: pos ? Math.max(8, pos.x) : 'max(8px, calc(50% - 490px))',
            }
        const st = store.state
        const sessionsByTask = {}
        for (const row of (store.sessions || [])) sessionsByTask[row.taskId] = row.sessions || []
        const onPD = (e) => {
          // 全屏/弹出模式不可拖动；按钮区域不启动拖拽/捕获，否则 setPointerCapture 会吞掉按钮的 click
          if (fs) return
          if (e.target && (e.target.tagName === 'BUTTON' || (typeof e.target.closest === 'function' && e.target.closest('button')))) return
          const el = e.currentTarget.parentElement
          const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0 }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
          setDrag({ sx: e.clientX, sy: e.clientY, bx: rect.left, by: rect.top })
        }
        const onPM = (e) => { if (drag) store.set({ pos: { x: Math.max(8, drag.bx + e.clientX - drag.sx), y: Math.max(8, drag.by + e.clientY - drag.sy) } }) }
        const onPU = () => setDrag(null)
        const onRS = (e) => {
          // 全屏/弹出模式不可缩放
          if (fs) return
          const el = e.currentTarget.parentElement
          const rect = el ? el.getBoundingClientRect() : { w: 980, h: 660, left: 0, top: 0 }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
          setResize({ sx: e.clientX, sy: e.clientY, bw: rect.width, bh: rect.height })
        }
        const onRM = (e) => {
          if (!resize) return
          const w = Math.max(640, Math.min(1400, resize.bw + e.clientX - resize.sx))
          const h = Math.max(420, Math.min(900, resize.bh + e.clientY - resize.sy))
          store.set({ size: { w, h } })
        }
        const onRU = () => setResize(null)
        const onPopout = () => {
          // 弹出到独立窗口（可拖到任意副屏）；被浏览器拦截时退化为应用内全屏
          try {
            if (typeof window === 'undefined' || typeof window.location === 'undefined') { store.set({ fullscreen: true }); return }
            const url = new URL(window.location.href)
            url.searchParams.set('cindy-popup', '1')
            const w = window.open(url.toString(), 'cindy-popup', 'popup=yes,width=1080,height=720')
            if (w) { try { w.focus() } catch (e) {}; store.set({ open: false }) }
            else store.set({ fullscreen: true })
          } catch (e) { store.set({ fullscreen: true }) }
        }
        const TABS = [['board', '总览'], ['calendar', '日历'], ['gantt', '甘特图'], ['journal', '日志'], ['settings', '设置']]
        const headStyle = fs ? { cursor: 'default', userSelect: 'none' } : { cursor: 'move', userSelect: 'none' }
        return h('div', { className: 'tk-panel', style },
          h('div', { className: 'tk-head', onPointerDown: onPD, onPointerMove: onPM, onPointerUp: onPU, style: headStyle },
            h('span', { className: 'tk-title' }, h(CindyLogo, { size: 24 }), 'Cindy · 任务秘书'),
            st && store.configured ? h('span', { className: 'tk-dim', style: { fontSize: 11, flex: 1, marginLeft: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, st.config.root) : h('span', { style: { flex: 1 } }),
            h('button', { className: 'tk-btn ghost tk-icn', title: '刷新', onClick: () => refresh() }, h(Ic, { paths: IC.refresh })),
            h('button', { className: 'tk-btn ghost tk-icn', title: fs ? '退出全屏' : '全屏', onClick: () => store.set({ fullscreen: !fs }) }, h(Ic, { paths: fs ? IC.minimize : IC.maximize })),
            h('button', { className: 'tk-btn ghost tk-icn', title: '弹出到独立窗口（可拖到其他屏幕）', onClick: onPopout }, h(Ic, { paths: IC.popout })),
            h('button', { className: 'tk-btn ghost tk-icn', title: '关闭', onClick: () => store.set({ open: false }) }, h(Ic, { paths: IC.close }))),
          h('div', { className: 'tk-tabs' }, TABS.map((x) => h('button', { key: x[0], className: 'tk-tab' + (store.tab === x[0] ? ' on' : ''), onClick: () => store.set({ tab: x[0] }) }, x[1]))),
          h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            // 关键顺序：未选目录时优先显示引导页（get-state 未配置时 state 为 null，
            // 若先判 !st 会永远卡在骨架屏，用户将没有机会选择目录）
            !store.configured ? h(Onboard)
            : !st ? (store.error
              ? h('div', { className: 'tk-body', style: { alignItems: 'center', justifyContent: 'center' } },
                  h('div', { className: 'tk-err', style: { textAlign: 'center' } }, '⚠️ ' + store.error),
                  h('button', { className: 'tk-btn primary', onClick: () => refresh({ attempts: 15 }) }, '↻ 重试'))
              : h('div', { className: 'tk-body' },
                  store.connecting ? h('div', { className: 'tk-dim', style: { textAlign: 'center', padding: 12 } }, '正在连接 DSH 服务…') : null,
                  h(Skeleton)))
            : store.tab === 'board' ? h(BoardTab, { state: st, sessionsByTask })
            : store.tab === 'calendar' ? h(CalendarTab, { state: st })
            : store.tab === 'gantt' ? h(GanttTab, { state: st })
            : store.tab === 'journal' ? h(JournalTab, { state: st })
            : h(SettingsTab, { state: st })),
          store.newTaskProductId ? h(TaskForm, { state: st }) : null,
          store.detailTaskId ? h(TaskDetail, { state: st, sessionsByTask }) : null,
          store.perf ? h('div', { className: 'tk-perf', title: '数据通道与加载耗时 · build ' + BUILD }, '加载 ' + store.perf.ms + 'ms · 直连 · ' + BUILD) : null,
          fs ? null : h('div', { className: 'tk-grip', title: '拖动调整大小', onPointerDown: onRS, onPointerMove: onRM, onPointerUp: onRU }, '⤡'))
      }

      // ---------- 设置 → 插件 → 可配置 卡片 ----------
      function SettingsPluginCard() {
        useStore()
        React.useEffect(() => { if (!store.state) refresh() }, [])
        const st = store.state
        const stats = st && st.stats ? st.stats : null
        const ready = !!(st && store.configured)
        return h('div', { className: 'tk-card', style: { padding: 12, cursor: 'default' } },
          h('div', { className: 'tk-row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'tk-card-name', style: { display: 'flex', alignItems: 'center', gap: 8 } }, h(CindyLogo, { size: 20 }), 'Cindy 任务秘书'),
              h('div', { className: 'tk-dim', style: { fontSize: 11, marginTop: 3, maxWidth: 520 } },
                store.error && !ready
                  ? ('⚠️ ' + store.error)
                  : ready
                    ? ('已启用 · ' + (stats.total || 0) + ' 个任务 · 进行中 ' + (stats.active || 0) + ' · 根目录 ' + st.config.root)
                    : '未初始化：请在面板中选定总目录后使用')),
            h('div', { className: 'tk-row', style: { flex: 'none' } },
              h('button', { className: 'tk-btn primary', onClick: () => store.set({ open: true, tab: 'board' }) }, '打开面板'),
              h('button', { className: 'tk-btn ghost', onClick: () => store.set({ open: true, tab: 'settings' }) }, '设置'))))
      }

      // ---------- 插槽注册（同步，不等待任何异步）----------
      const disposers = []
      if (!isPopup) {
        // 主窗口：侧边栏按钮 + 设置页卡片
        disposers.push(slots.inject('sidebar.footer.action', () => slots.register(
          { name: 'sidebar.footer.action', id: 'cindy', label: 'Cindy' },
          () => h('button', { className: 'tk-footbtn', title: 'Cindy 任务秘书', onClick: () => store.set({ open: !store.open }) },
            h(CindyLogo, { size: 18 }), h('span', null, 'Cindy')),
        )))
        disposers.push(slots.inject('settings.plugin.item', () => slots.register(
          { name: 'settings.plugin.item', id: 'cindy', order: 1, label: 'Cindy' },
          () => h(SettingsPluginCard),
        )))
      }
      // 弹窗/主窗口都注册全屏面板（弹窗模式 store.open 已强制为 true）
      disposers.push(slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'cindy-panel' },
        () => h(Panel),
      )))

      // 预热：后台自动重试拉取状态（连接未就绪时短间隔重试，DSH 一就绪内容立刻出现）
      refresh({ attempts: 15 })
      console.log('[cindy] Client 半边已启动（build ' + BUILD + '）')

      return () => {
        for (const d of disposers) { try { d() } catch (e) {} }
      }
    }

    exports.name = 'cindy-client'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
