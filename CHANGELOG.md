# 更新日志（Changelog）

> **约定（重要）**：每次发布新版本都必须更新本文件，说明「版本 → 版本」的变更内容与**升级步骤**。
> 版本号遵循语义化版本（主.次.补丁）：新增功能 = 次版本；修复/界面调整 = 补丁版本。
> 其他设备升级时：对照本文件看「从上一版本升级」一节，按步骤操作即可。

## [0.3.0] - 2026-08-19（当前）

### 新增（工作区目录对账）

- **刷新即对账**：在工作区里**删除/改名**了任务或产品目录后，点面板「↻ 刷新」（或每 5 分钟自动）即与磁盘实况同步：
  - 目录被删除 → 任务/产品标记 `dirMissing`（⚠️ 目录缺失 红标，总览/列表同步提示），**不自动删记录**（数据安全优先）；目录恢复后自动清除标记
  - 产品目录改名 → 自动识别（扫描根目录中含该产品任务名子目录的目录）并跟随更新产品与全部任务的路径
- 对账结果自动记入日志（journal），便于追溯

### 从上一版本（0.2.2）升级

1. `git pull` 获取 0.3.0 源码
2. 重新运行安装脚本：`powershell -ExecutionPolicy Bypass -File install-cindy.ps1`
3. 重启 DSH

> 数据完全兼容，无需迁移。

---

## [0.2.2] - 2026-08-19

### 修复

- **新建任务超时但实际已成功**：客户端写操作超时由固定 5s 放宽到 30s（读操作仍 5s），根治「请求超时 → 重试 → 报同名已存在」；`create-task` 改为幂等，同名任务已存在时直接返回现有任务（提示可能为上次超时但实际已成功）
- 任务目录改为一次 shell 批量创建（cmd `mkdir` 多参数），避免逐目录启动进程拖慢建任务
- 服务端互斥锁超时 30s → 60s（慢磁盘/杀毒软件场景留余量）

### 从上一版本（0.2.1）升级

1. `git pull` 获取 0.2.2 源码
2. 重新运行安装脚本覆盖 lib（本次改了 `lib/index.js` + `lib/client.js`）：
   `powershell -ExecutionPolicy Bypass -File install-cindy.ps1`
3. 重启 DSH

> 数据完全兼容，无需迁移。

---

## [0.2.1] - 2026-08-17

### 变更（UI 调整）

- 任务详情：**保存 / 删除任务按钮移到进度条右侧**，操作更顺手（原在备注下方独立一行）
- 任务卡片：新增 **📂 一键打开工作区文件夹**按钮（点击直接用文件资源管理器打开该任务/工作区文件夹）

### 从上一版本（0.2.0）升级

1. `git pull`（或重新 clone）获取 0.2.1 源码
2. 重新运行安装脚本覆盖 lib（本次改了 `lib/client.js`）：
   `powershell -ExecutionPolicy Bypass -File install-cindy.ps1`
3. 重启 DSH

> 数据完全兼容：0.2.0 的 `.taskman/` 数据与根目录记忆（`cindy-root.json`）无需任何迁移。

---

## [0.2.0] - 2026-08-17

### 新增（大版本）

- **会议记录与行动项跟踪**：`cindy_create_meeting` / `cindy_meetings` / `cindy_meeting` / `cindy_meeting_action` 四个工具；纪要自动写入任务目录 `project/会议记录/`，行动项状态变更自动刷新纪要并记日志；日报/周报自动提醒未完成行动项
- **日报/周报 Markdown + HTML 美化双版本**（存于 `<根目录>/.taskman/reports/`）
- **任务阶段全局可自定义**（设置页或 `set-config` 的 `stages` 字段；最后一个阶段视为已关闭）
- **产品/任务两级 harness 工作区树联动**：创建产品/任务自动注册产品工作区与任务工作区，侧边栏按路径祖先显示 产品 → 任务 → 会话 层级；旧数据周期刷新自动补建
- **根目录记忆**：首次选择写入 `cindy-root.json`（DSH 用户目录），重启自动恢复；可用环境变量 `CINDY_ROOT` 覆盖

### 从上一版本（0.1.1）升级

1. 重新运行 `install-cindy.ps1`（包名已修正为 `@mrchenxiangyu/cindy-taskman`，安装脚本会清理旧包名 `@cindy/taskman` 遗留）
2. 重启 DSH
3. 首次打开面板选择根目录（或设 `CINDY_ROOT`）——旧数据目录（含 `.taskman/`）可直接复用

---

## [0.1.1] - 初始正式版

### 内容

由「任务管家」动态插件固化为 DSH 正式插件（`@mrchenxiangyu/cindy-taskman`）：

- 开机自动加载、界面默认可见（侧边栏「👩‍💼 Cindy」按钮）
- 按产品管理任务；模板化生成任务目录（script/data/output/outcome/reference/project 可自定义）
- **任务文件夹即 harness 工作区**；日历（日/周/月）、甘特图、日志、管理面板（按产品/阶段分组）
- 会话监控（`tools/result`、`agent/status` → 任务日志，节流去重）
- 日报/周报（Markdown）+ 9 个 `cindy_*` 模型工具

### 安装

`git clone https://github.com/mrchenxiangyu/cindy-taskman.git` → `install-cindy.ps1` → 重启 DSH。
