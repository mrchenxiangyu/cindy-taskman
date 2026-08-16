# =====================================================================
# Cindy 任务秘书 —— 发布到 npm 的脚本
# 用法：
#   1) 先登录 npm：npm login   （一次性；或用 npm token create 生成令牌）
#   2) 运行本脚本：powershell -ExecutionPolicy Bypass -File publish-cindy.ps1
# 说明：自动检查登录状态 → 展示将发布的文件 → 确认后 npm publish。
#       发布成功后，新设备可 `dsh plugin --profile web add @mrchenxiangyu/cindy-taskman`。
# =====================================================================
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

Write-Output '== 检查 npm 登录状态 =='
$who = npm whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "未登录 npm。请先执行：npm login`n（或设置令牌：npm config set //registry.npmjs.org/:_authToken=<token>）"
}

$reg = npm config get registry
Write-Output "当前账号：$who"
Write-Output "registry：$reg"

Write-Output ''
Write-Output '== 即将发布的文件（npm pack --dry-run）=='
npm pack --dry-run

Write-Output ''
$ver = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Output "== 发布 @mrchenxiangyu/cindy-taskman@$ver =="
Write-Output '（若账号开启了发布 2FA，npm 会提示 Enter one-time password，请输入认证器 6 位验证码）'
npm publish
if ($LASTEXITCODE -ne 0) { Write-Error '发布失败，见上方报错（常见：@cindy 作用域已被他人占用 → 需换包名）。' }
Write-Output '发布成功！'
Write-Output '新设备安装：npm i -g pnpm 后执行 dsh plugin --profile web add @mrchenxiangyu/cindy-taskman'
