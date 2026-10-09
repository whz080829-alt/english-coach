@echo off
rem ============================================================
rem  英语提分教练 · 全栈版 启动器
rem  1) 确保后端（Python + SQLite）在跑
rem  2) 用「独立应用窗口」打开，像原生桌面软件（没有地址栏、没有标签页、
rem     任务栏有单独图标）。找不到 Chromium 浏览器时退回默认浏览器。
rem
rem  本窗口就是后端服务：最小化即可，学习期间请不要关闭。
rem  关闭本窗口 = 停止服务（也可用同目录的「停止服务器.cmd」）。
rem ============================================================
setlocal
cd /d "%~dp0"
set "PORT=8788"
set "URL=http://127.0.0.1:%PORT%/index.html"

rem 被自己以 --open 参数再次调用时，只负责打开窗口
if /i "%~1"=="--open" goto openapp

rem ---------- 1. 服务已在跑？直接开窗口 ----------
call :probe
if not errorlevel 1 goto openonly

rem ---------- 2. 找 Python ----------
set "PY=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if exist "%PY%" goto serve
set "PY="
where py >nul 2>nul
if %errorlevel%==0 set "PY=py"
if defined PY goto serve
where python >nul 2>nul
if %errorlevel%==0 set "PY=python"
if defined PY goto serve
goto nopython

:serve
title 英语提分教练 全栈版 - 关闭本窗口即停止服务
echo.
echo   ============================================================
echo    英语提分教练 · 全栈版
echo   ============================================================
echo    本机地址：%URL%
echo.
echo    手机/其它电脑：连同一 Wi-Fi，用页面里
echo    「设置 → 安装与分享」显示的局域网地址或二维码打开。
echo    第一次注册的账号是管理员；不注册也能用（数据存本机）。
echo.
echo    本窗口就是后端服务（Python + SQLite），最小化即可。
echo    关闭本窗口 = 停止服务。
echo.
rem 延迟 2 秒，等后端就绪后再开窗口（复用本脚本的 --open 分支）
start "打开英语提分教练" /min cmd /c "timeout /t 2 /nobreak >nul && ""%~f0"" --open"
rem --host 0.0.0.0：开放局域网访问，手机/其它电脑连同一 Wi-Fi 即可注册使用
"%PY%" "server\app.py" --port %PORT% --host 0.0.0.0
echo.
echo   服务已停止。
pause
exit /b 0

:openonly
echo 后端已在运行，正在打开应用窗口...
goto openapp

rem ---------- 打开应用窗口（优先 Chromium 的 --app 独立窗口）----------
:openapp
set "BROWSER="
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER goto openplain
rem --app=URL：无地址栏、无标签页的独立窗口，任务栏显示本应用图标
start "" "%BROWSER%" --app=%URL% --window-size=1200,860 --no-first-run
exit /b 0

:openplain
echo （没找到 Edge/Chrome，改用默认浏览器打开）
start "" "%URL%"
exit /b 0

:nopython
echo.
echo   没有找到 Python，无法启动后端。
echo   你可以直接双击 web\index.html 使用（本机模式，无账号与云同步）。
echo.
start "" "%~dp0web\index.html"
pause
exit /b 0

rem ---------- 子过程：端口是否在监听 ----------
:probe
powershell -NoProfile -Command "try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%PORT%); $c.Close(); exit 0 }catch{ exit 1 }" >nul 2>nul
exit /b %errorlevel%
