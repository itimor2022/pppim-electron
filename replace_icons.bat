@echo off
echo 正在替换应用图标...

REM 请先手动将图标文件转换为以下格式：
REM 1. 将 图标/photo_6143349821394766048_m.jpg 转换为 icon.ico (256x256)
REM 2. 将 图标/photo_6143349821394766048_m.jpg 转换为 icon.png (512x512)
REM 3. 将 图标/photo_6143349821394766048_m.jpg 转换为 tray.png (16x16)
REM 4. 将 图标/photo_6143349821394766048_m.jpg 转换为 tray@2x.png (32x32)

REM 然后取消注释以下行来替换图标：
REM copy "icon.ico" "public\icons\icon.ico"
REM copy "icon.png" "public\icons\icon.png"
REM copy "tray.png" "public\icons\tray.png"
REM copy "tray@2x.png" "public\icons\tray@2x.png"

echo 图标替换完成！
echo 请确保已经转换了图标格式并取消注释上面的复制命令。
pause
