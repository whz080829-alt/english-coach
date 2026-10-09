@echo off
rem 停止「英语提分教练 · 全栈版」的后端服务
setlocal
set "PORT=8788"
set "PIDFILE=%TEMP%\ecc_pids_%PORT%.txt"
if exist "%PIDFILE%" del "%PIDFILE%" >nul 2>nul

echo 正在查找监听 %PORT% 端口的后端服务...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%PORT%" ^| findstr /c:"LISTENING"') do (
  echo %%p>>"%PIDFILE%"
)

if not exist "%PIDFILE%" (
  echo   没有找到正在运行的服务。
  goto check
)

echo.
for /f %%p in (%PIDFILE%) do (
  echo   结束进程 PID %%p
  taskkill /f /pid %%p >nul 2>nul
)
rem 兜底：taskkill 被权限拦截时用 PowerShell 再停一次
powershell -NoProfile -Command "Get-Content '%PIDFILE%' | Sort-Object -Unique | ForEach-Object { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue }" >nul 2>nul
del "%PIDFILE%" >nul 2>nul

:check
echo.
echo   正在确认结果...
powershell -NoProfile -Command "try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%PORT%); $c.Close(); exit 0 }catch{ exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo   已停止。网页刷新后将无法打开；需要时双击桌面快捷方式即可重启。
) else (
  echo   端口 %PORT% 仍在响应，请手动在任务管理器里结束 python.exe。
)
echo.
pause
