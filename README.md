# Cindy 任务秘书（@mrchenxiangyu/cindy-taskman）

把「任务管家」固化为 DSH 正式插件：开机自动加载、界面默认可见。按产品管理任务、模板化生成任务目录、任务文件夹即 harness 工作区、日历/甘特图/日志/管理面板、自动监控会话进度并生成日报周报。v0.2.0 起新增**会议记录与行动项跟踪**、**专业日报/周报（Markdown + HTML 美化版）**。

## 一键安装（npm）

```powershell
npm i -g pnpm
dsh plugin --profile web add @mrchenxiangyu/cindy-taskman
```

重启 DSH 后，侧边栏底部出现「👩‍💼 Cindy」按钮。首次打开面板会引导你**选择一个工作目录**（所有产品/任务文件夹与 `.taskman/` 管理数据都存放在该目录下）；选择一次后会自动记住，之后每次启动自动恢复。

> 本地拷贝安装：克隆本仓库后运行 `install-cindy.ps1`（幂等，无需 npm 发布）。

## 架构

| 能力 | 实现 |
| --- | --- |
| Client→Host RPC | `TypertRemoteService('cindy')` + `invoke(method, args)`，网关 `cindy/invoke` 端点（严格描述符 + 透传 codec，免生成 manifest） |
| 模型工具 | `ctx.tools.register(defineTool(...))`，13 个 `cindy_*` 工具（含会议 4 个） |
| 会话监控 | `tools/result`、`agent/status` 事件 → 写入任务日志（10/30 分钟节流） |
| 会议记录 | `.taskman/meetings.json` 结构化存储 + 任务目录 `project/会议记录/` Markdown 纪要；行动项状态跟踪，日报/周报自动提醒未完成项 |
| 日报/周报 | 定时调度 + 手动触发，Markdown + HTML 美化版存于 `<根目录>/.taskman/reports/`；内容简洁（概要 + 目的/做了什么/过程/结论/成果），不列命令刷屏 |
| 根目录记忆 | 首次由用户选择；选择写入 DSH 用户目录 `cindy-root.json`，重启自动恢复（环境变量 `CINDY_ROOT` 可覆盖） |
| 界面 | `__ModuleLoader__.load` bundle：侧边栏按钮 + 浮动面板（总览/日历/甘特图/日志/设置）+ 设置页卡片 |

## 数据布局（根目录下）

```
<根目录>/
├── .taskman/
│   ├── config.json / products.json / templates.json / tasks.json
│   ├── meetings.json      # 会议记录与行动项（结构化）
│   ├── journal.jsonl      # 追加式活动日志
│   └── reports/           # YYYY-MM-DD.daily.{md,html}、YYYY-Www.weekly.{md,html}
├── <产品名>/
│   └── <任务名>/          # = harness 工作区（模板化目录 + README.md）
│       └── project/会议记录/   # 每次会议的 Markdown 纪要（自动生成、随行动项状态刷新）
```

全部为可读 JSON/Markdown，可 git 追踪、可整体迁移目录。

## 模型工具

`cindy_overview` / `cindy_set_root` / `cindy_create_product` / `cindy_create_template` / `cindy_create_task` / `cindy_progress` / `cindy_tasks` / `cindy_daily_summary` / `cindy_weekly_report`

会议（v0.2.0 新增）：
`cindy_create_meeting`（记录会议：主题/参会人/讨论内容/结论/行动项，自动生成纪要）· `cindy_meetings`（查看会议列表 + 行动项完成情况）· `cindy_meeting`（单场会议详情）· `cindy_meeting_action`（更新行动项状态/负责人/截止，自动记日志并刷新纪要）

## 已知边界

- 删除任务只移除秘书处记录，磁盘目录与工作区保留（数据安全优先）。
- 报告为确定性结构化撰写，未接 LLM 润色；内容简洁（概要一段话 + 每任务 目的/做了什么·方法/过程/结论/成果），HTML 版供面板美化预览。
- 会议纪要文件（`project/会议记录/`）由 Cindy 自动生成与刷新，行动项状态变更后同步更新勾选状态。
- 任务阶段为**全局可自定义**：设置页「任务阶段」或 `set-config` RPC 的 `stages` 字段（存于 `.taskman/config.json`）；最后一个阶段视为已关闭/归档。
- **harness 工作区联动**：创建/更新产品时自动注册「产品工作区」（产品文件夹），创建任务时注册「任务工作区」并挂在产品工作区下；侧边栏工作区按路径祖先自动显示两级树（产品 → 任务 → 会话），旧数据在周期刷新时自动补建产品工作区。删除产品/任务只移除秘书处记录，工作区与磁盘目录保留（数据安全优先）。
- 产品级自定义阶段为后续增强。
- 依赖 DSH 自带包（cordis / dsh-typert-protocol / dsh-tools / dsh-client-*），无需额外安装；要求 DSH 版本与开发时一致（rc.6）。

## 开发

- `lib/index.js` — Host 半边；`lib/client.js` — Client 半边（预构建 bundle）
- 修改后：同步 `lib/` 与 `package.json` 到 profile 的 node_modules 对应包目录 → 重启 DSH
- 发布：`publish-cindy.ps1`（自动检查登录 → 预览 → `npm publish`，需 2FA 验证码）
