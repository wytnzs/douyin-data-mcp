#!/bin/sh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] 没找到 Node.js。"
  echo ""
  echo "  请先到 https://nodejs.org 下载 22 或更高版本的 LTS 版装上。"
  echo "  装完关掉这个窗口，重新双击本文件。"
  echo ""
  read -r _ 
  exit 1
fi

node scripts/check.mjs --launch
