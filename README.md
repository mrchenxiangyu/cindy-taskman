# 任务管家 → Cindy 任务秘书 — 状态说明（已固化）

> 2026-08 起，任务管家已固化为 **DSH 正式插件 `@cindy/taskman`**，改名 **Cindy 任务秘书**。
> 不再需要重启后手动重载：**开机/启动 DSH 即自动加载，界面默认可见**。

## 安装位置

- **源码（本目录，可改）**：`D:\deepseek_workspace\workspace_plugin\taskman-plugin\`
  - `lib/index.js` — Host 半边（ESM，正式插件格式）
  - `lib/client.js` — Client 半边（`window.__ModuleLoader__.load` 预构建 bundle）
  - `package.json` — 含 `dsh.client` 声明（web 扫描进 `window.__DSH_BOOT__`）
  - `host.js` / `client.js` — 旧动态插件源码（仅历史参考，不再使用）
- **成品（运行用）**：`C:\Users\19121\.dsh\profiles\node_modules\@cindy\taskman\`
- **组合行**：`C:\Users\19121\.dsh\profiles\web\cordis.patch.yml`
  ```yaml
  - insert:
      - id: cindy
        name: '@cindy/taskman'
  ```
- **数据**：`D:\deepseek_workspace\taskman-demo\`（`.taskman/` 全部管理数据，随目录迁移）

## 架构（与动态版的差异）

| 能力 | 动态版（harness.*） | 固化版（真实 API） |
| --- | --- | --- |
| Client→Host RPC | `host.call(m, a)` 包私有通道 | `TypertRemoteService('cindy')` + `invoke(method, args)`，网关 `cindy/invoke` 端点（SRC/严格描述符，透传 codec，无需生成 manifest） |
| 模型工具 | `harness.defineTool/registerTool` | `ctx.tools.register(defineTool(...))`，9 个 `cindy_*` 工具 |
| 会话监控 | `tools/result`、`agent/status` 事件 | 相同事件，直接 `ctx.on` |
| 定时器 | `ctx.interval/timeout` | 相同（`timer` 注入） |
| 界面 | 动态 Client 全局（styles/host/slots） | `__ModuleLoader__.load` bundle：`require('react')`、样式自注入 `<style>`、`ctx.remote.$mount` 挂端点后 `ns.invoke` |
| 插槽 | sidebar.footer.action / shell.overlay / tool.view.cordis / settings.plugin.item | sidebar.footer.action / shell.overlay / settings.plugin.item（cordis_run 卡片入口对正式插件无意义，已去掉） |

## 改名

- 界面：侧边栏「👩💼 Cindy」按钮；面板「Cindy · 任务秘书」；设置→插件→「Cindy 任务秘书」卡片
- 工具：`cindy_overview / cindy_set_root / cindy_create_product / cindy_create_template / cindy_create_task / cindy_progress / cindy_tasks / cindy_daily_summary / cindy_weekly_report`
- 数据兼容：`.taskman/` 结构不变，指向原目录即完整恢复

## 修改后如何生效

改 `lib/*` 或 `package.json` 后，把 `lib/`、`package.json` 复制到
`C:\Users\19121\.dsh\profiles\node_modules\@cindy\taskman\`，然后**重启 DSH** 即可
（clientModules 对插件集变化按重启生效；bundle 内容哈希会在重启后自然更新）。

## 自测

Host 半边已用真实 Cordis Context + 桩服务跑通 8 项断言：
插件形状 / apply 无异常 / cindy 服务注册（typertRemote 绑定）/ typert.register
调用 / cindy/invoke 端点 / 9 工具注册 / invoke 分发（get-state、未知方法错误）。

## 已知边界（沿用 v1）

- 删除任务只移除秘书处记录，磁盘目录与工作区保留（数据安全优先）。
- 报告为确定性结构化撰写，未接 LLM 润色。
- 产品级自定义阶段为后续增强。

## 换设备（插件可完整迁移；数据不强求通用）

**目标**：插件本体在新设备上「装完即用、功能完整」。数据/工作区按需迁移，不做硬依赖。

1. 新设备安装**同版本 DSH** 并启动过一次 web；
2. 拷贝本目录（源码）到新设备；
3. 运行一键安装脚本：
   ```powershell
   powershell -ExecutionPolicy Bypass -File <源码路径>\install-cindy.ps1
   ```
   （自动：复制 `lib/` + `package.json` 到 profile node_modules、写入 `cordis.patch.yml` 组合行，幂等）
4. 重启 DSH → 侧边栏出现「Cindy」，**从零数据即可完整使用**（内置模板自动创建，面板建产品/建任务/日报周报、9 个 `cindy_*` 工具全部可用；已用「全新空目录首启」场景端到端验证）。

可选迁移数据：把旧机数据目录（含 `.taskman/`）拷到新机，面板设置根目录 / `cindy_set_root` / 环境变量 `CINDY_ROOT` 三选一，任务工作区自动补注册。

依赖说明：插件只依赖 DSH 自带包（cordis、dsh-typert-protocol、dsh-tools 及 client 侧的 dsh-client-* 模块），**无需额外 npm install**；唯一要求是 DSH 版本与开发时一致（rc.6）。
