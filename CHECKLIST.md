# 任务管家 v1.2 — 验收清单（Verification Checklist）

> Host 核心链路已由插件工具端到端自测通过：set-root（含持久化重载）/建产品/建任务（六目录模板 + 工作区注册）/进度记录/日报/周报/总览。
> 剩余验收为 UI 部分：在 cordis_run 卡片上点击 ✓ 授权后按以下步骤逐项验收。

## 0. 激活
- [ ] 界面 Run 卡片出现「任务管家 v1.2 完整版」并点击授权（✓ 本次 / ✓✓ 以后版本免审）
- [ ] 侧边栏底部出现「📅 任务管家」按钮
- [ ] 对话流中 cordis_run 卡片内出现任务管家快捷卡片（未初始化提示）

## 1. 根目录
- [ ] 打开面板 → 出现初始化引导；「浏览…」或输入路径后「启用」
- [ ] 目标目录下生成 `.taskman/`（config.json / templates.json + reports/）
- [ ] 内置模板「通用任务模板」包含 script/data/output/outcome/reference/project 六项
- [ ] 已自测验证：可指向任意含 `.taskman/` 的数据目录直接查看自测数据（产品 B300雷达 / 任务 性能比测 / 两份报告）

## 2. 产品与模板
- [ ] 设置页创建产品「B300雷达」→ 根目录出现 `B300雷达/README.md`
- [ ] 新建自定义模板（如 `docs|文档\ndocs/meeting|会议记录`）并保存、编辑、删除

## 3. 一键建任务（核心，已由工具自测通过）
- [ ] 总览页 B300雷达 列下「＋ 新建任务」→ 任务名「性能比测」、选模板、设起止日期 → 创建
- [ ] 生成 `B300雷达/性能比测/{script,data,output,outcome,reference,project}/README.md`
- [ ] 任务 README.md 含任务元信息
- [ ] 任务详情显示「工作区：3755ce6e…」（已注册为 harness 工作区）
- [ ] 详情页「💬 打开工作区会话」→ 侧边栏出现以该任务文件夹为工作区的新会话

## 4. 视图
- [ ] 总览：按产品 / 按阶段两种分组；卡片显示阶段徽标、优先级、进度条、关联会话数
- [ ] 日历：日/周/月切换、前后翻页、今天高亮；点击任务条打开详情；点击空格进入日视图
- [ ] 甘特图：色条按起止日期定位、今日红线、按产品分组；点击色条打开详情
- [ ] 日志：手动添加进度记录；按任务/类型过滤；报告列表与预览

## 5. 自动监控（harness 集成）
- [ ] 在「性能比测」工作区的新会话里对任务文件夹做几次 read/write/edit
- [ ] 日志页出现「会话活动」记录（如：会话操作 write：script/xxx.py），10 分钟内同类操作去重
- [ ] 会话开始/结束（agent/status 事件）同样写入日志

## 6. 日报 / 周报（已由工具自测通过）
- [ ] 总览页「生成日报 / 生成周报」→ 弹出 Markdown 报告
- [ ] `.taskman/reports/YYYY-MM-DD.daily.md` 与 `YYYY-Www.weekly.md` 生成
- [ ] 报告含概览、进展明细、阶段变更、逾期风险、近期提醒/下周计划
- [ ] 设置页可改每日总结时间与周报日（到点后每 5 分钟自动检查生成）

## 7. 模型工具（已由工具自测通过）
- [ ] `taskman_overview` 返回全局概览
- [ ] `taskman_create_product` / `taskman_create_template` / `taskman_create_task` / `taskman_progress` / `taskman_tasks` 可操作
- [ ] `taskman_daily_summary` / `taskman_weekly_report` 直接产出报告

## 8. 数据安全
- [ ] `.taskman/` 全部为可读 JSON/Markdown（可 git 追踪）
- [ ] 插件写入自我约束在总目录内（fs.contains 校验）；删除任务只移除记录，目录与工作区保留

## 已知边界（v1 有意为之）
- 动态插件重启后需重新指向根目录（数据都在 `.taskman/`，重指即恢复）；固化到预设后可自动恢复
- 报告为确定性结构化撰写，未接 LLM 润色（v2 候选：`llm.stream`）
- 任务删除不删除磁盘目录；产品级自定义阶段为后续增强
