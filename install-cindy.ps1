# =====================================================================
# Cindy 任务秘书 —— 新设备一键安装脚本
# 用法（在新设备上，先安装并启动过一次 DSH web 后执行）：
#   powershell -ExecutionPolicy Bypass -File install-cindy.ps1
# 可选参数：
#   -Source      插件源码目录（默认 D:\deepseek_workspace\workspace_plugin\taskman-plugin）
#   -ProfileRoot DSH 用户 profile 目录（默认 $env:USERPROFILE\.dsh\profiles\web）
# 说明：把插件包复制进 profile 的 node_modules，并在 cordis.patch.yml 写入组合行；
#       重启 DSH 后 Cindy 自动加载。数据目录需另行拷贝（见最后提示）。
# =====================================================================
param(
  [string]$Source = 'D:\deepseek_workspace\workspace_plugin\taskman-plugin',
  [string]$ProfileRoot = "$env:USERPROFILE\.dsh\profiles\web"
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $Source 'package.json'))) { throw "找不到插件源码：$Source" }
if (-not (Test-Path (Join-Path $ProfileRoot 'cordis.yml'))) { throw "找不到 DSH profile（未启动过 web？）：$ProfileRoot" }

$nm = Join-Path (Split-Path $ProfileRoot -Parent) 'node_modules'
$dest = Join-Path $nm '@cindy\taskman'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $Source 'package.json') $dest -Force
Copy-Item (Join-Path $Source 'lib') (Join-Path $dest 'lib') -Recurse -Force
Write-Output "[1/2] 插件包已安装到 $dest"

$patch = Join-Path $ProfileRoot 'cordis.patch.yml'
$raw = [System.IO.File]::ReadAllText($patch)
$block = "# ── Cindy 任务秘书（@cindy/taskman）────────────────────────" + [Environment]::NewLine +
         "- insert:" + [Environment]::NewLine +
         "    - id: cindy" + [Environment]::NewLine +
         "      name: '@cindy/taskman'" + [Environment]::NewLine
if ($raw -match "^\s*\[\s*\]\s*$") {
  # 默认空补丁文件：整体替换
  [System.IO.File]::WriteAllText($patch, $block, (New-Object System.Text.UTF8Encoding($true)))
  Write-Output "[2/2] 已写入组合补丁：$patch"
} elseif ($raw -match "name:\s*'@cindy/taskman'") {
  Write-Output "[2/2] 组合补丁已包含 Cindy，跳过：$patch"
} else {
  [System.IO.File]::AppendAllText($patch, [Environment]::NewLine + $block, (New-Object System.Text.UTF8Encoding($true)))
  Write-Output "[2/2] 已追加组合补丁：$patch"
}

Write-Output ''
Write-Output '重启 DSH 后生效（Ctrl+C 后重跑 dsh web）。'
Write-Output '数据迁移：把原机器的数据目录（含 .taskman/）拷到本机，然后在面板「设置」填入根目录，'
Write-Output '或用 cindy_set_root 工具 / 环境变量 CINDY_ROOT 指定 —— 任务工作区会自动补注册，无需手工处理。'
