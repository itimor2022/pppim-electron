# openim-pc-refactor

## 打包命令

### 打包 Windows 版本（无签名）
```bash
npm run build && npx electron-builder --win --x64
```

### 打包 macOS 版本（无签名）
```bash
npm run build && npx electron-builder --mac
```

### 同时打包 Windows 和 macOS（无签名）
```bash
npm run build && npx electron-builder --win --mac
```
