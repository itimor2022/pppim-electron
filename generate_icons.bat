@echo off
chcp 65001 >nul
echo 🚀 图标生成工具
echo ================

REM 检查 Node.js 是否安装
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js 未安装，请先安装 Node.js
    pause
    exit /b 1
)

REM 检查是否有源图标文件
set SOURCE_ICON=
if exist "new_icon_256.png" set SOURCE_ICON=new_icon_256.png
if exist "original.png" set SOURCE_ICON=original.png
if exist "temp_icon.png" set SOURCE_ICON=temp_icon.png
if exist "icon.png" set SOURCE_ICON=icon.png

if "%SOURCE_ICON%"=="" (
    echo ❌ 未找到源图标文件
    echo 请确保以下文件之一存在:
    echo   - new_icon_256.png
    echo   - original.png
    echo   - temp_icon.png
    echo   - icon.png
    echo.
    echo 或者手动指定: generate_icons.bat 图标文件名
    pause
    exit /b 1
)

if "%1" neq "" set SOURCE_ICON=%1

echo 📂 使用源图标: %SOURCE_ICON%

REM 运行 Node.js 脚本
node generate_icons.js "%SOURCE_ICON%"

if %errorlevel% equ 0 (
    echo.
    echo ✅ 图标生成完成！
    echo 💡 提示: 现在可以运行 npm run build:win 重新打包应用
) else (
    echo.
    echo ❌ 图标生成失败
)

echo.
pause
