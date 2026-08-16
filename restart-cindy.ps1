# 一键重启 DSH web —— 用于加载 Cindy 任务秘书（@mrchenxiangyu/cindy-taskman）
# 用法：在任意终端运行  powershell -ExecutionPolicy Bypass -File restart-cindy.ps1
# 注意：会结束当前 DSH 进程（本会话随之结束），然后以同一命令重新拉起。
$ErrorActionPreference = 'Stop'
$port = 3080

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw '未找到 node（请确认已安装并加入 PATH）' }

# 通过 require.resolve 定位 dsh CLI 入口，不依赖任何固定安装路径
$bin = node -e "process.stdout.write(require.resolve('@deepseek-ai/dsh/lib/bin.js'))"
if (-not $bin) { throw '未找到 @deepseek-ai/dsh（请确认 DSH 已安装）' }

$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Write-Output "结束 DSH 进程 PID=$($conn.OwningProcess) ..."
    Stop-Process -Id $conn.OwningProcess -Force
    Start-Sleep -Seconds 2
} else {
    Write-Output "端口 $port 无监听进程，直接启动。"
}

Start-Process -FilePath $node.Source -ArgumentList @($bin, 'web') -WorkingDirectory $HOME -WindowStyle Normal
Write-Output "DSH web 已重启：http://127.0.0.1:$port （侧边栏底部应出现「👩‍💼 Cindy」）"
