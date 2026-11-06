# B6 · demo GIF 生成（peripheral.cast → peripheral.gif）

工具：[agg](https://github.com/asciinema/agg) v1.9.0（单文件 exe，Windows/macOS/Linux 预编译）。

```bash
# 1) 取 agg（Windows 示例；其他平台见 release 页）
curl -sL -o agg.exe https://github.com/asciinema/agg/releases/download/v1.9.0/agg-x86_64-pc-windows-msvc.exe

# 2) 从 cast 渲染 GIF（中文字体带 fallback；12 事件约 244KB）
agg.exe --cols 88 --rows 24 --speed 1.5 \
  --font-family "Cascadia Mono,Microsoft YaHei" \
  --theme monokai \
  docs/demo/peripheral.cast docs/demo/peripheral.gif

# 3) cast 需要重录时
node scripts/record-cast.mjs
```

产物 `docs/demo/peripheral.gif`（v1：12 事件、247KB、monokai）。参数含义：`--cols/--rows` 终端尺寸跟 cast 录制一致，`--speed 1.5` 加速播放。换主题/尺寸直接改参重跑，超过 2MB 时只提交本脚本与 cast、GIF 走 release 附件。
