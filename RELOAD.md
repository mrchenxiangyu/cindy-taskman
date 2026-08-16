# RELOAD（旧手册，已过时）

任务管家已固化为正式插件 **@cindy/taskman（Cindy 任务秘书）**，**不再需要重载**：
开机/启动 DSH 即自动加载，侧边栏默认出现「👩‍💼 Cindy」按钮。

- 源码：`D:\deepseek_workspace\workspace_plugin\taskman-plugin\`（`lib/index.js` Host、`lib/client.js` Client）
- 安装：`C:\Users\19121\.dsh\profiles\node_modules\@cindy\taskman\`
- 组合：`C:\Users\19121\.dsh\profiles\web\cordis.patch.yml`（`- id: cindy, name: '@cindy/taskman'`）
- 生效：修改后复制 `lib/` 与 `package.json` 到安装位置 → 重启 DSH（可用 `restart-cindy.ps1`）
- 数据：`D:\deepseek_workspace\taskman-demo\`（启动时自动恢复，零配置）

详细说明见 README.md。
