# 一键重启 DSH web —— 用于加载 Cindy 任务秘书（@cindy/taskman）
# 用法：在任意终端运行  powershell -ExecutionPolicy Bypass -File restart-cindy.ps1
# 注意：会结束当前 DSH 进程（本会话随之结束），然后以同一命令重新拉起。
$ErrorActionPreference = 'Stop'
$port = 3080
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Write-Output "结束 DSH 进程 PID=$($conn.OwningProcess) ..."
    Stop-Process -Id $conn.OwningProcess -Force
    Start-Sleep -Seconds 2
} else {
    Write-Output "端口 $port 无监听进程，直接启动。"
}
$node = 'D:\nodejs\node.exe'
$bin  = 'D:\nodejs\node_global\node_modules\@deepseek-ai\dsh\lib\bin.js'
Start-Process -FilePath $node -ArgumentList @($bin, 'web') -WorkingDirectory 'C:\Users\19121' -WindowStyle Normal
Write-Output "DSH web 已重启：http://127.0.0.1:$port （侧边栏底部应出现「👩‍💼 Cindy」）"
