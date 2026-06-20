#!/bin/bash

# Web Server Startup Script for Legal Map Viewer
# Usage: ./start.sh

PORT=8000
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo "=============================================="
    echo "⚠️  ポート ${PORT} はすでに使用されています。"
    echo "すでにサーバーが起動している可能性があります。"
    echo "ブラウザで http://localhost:${PORT}/ を開いてみてください。"
    echo "=============================================="
else
    echo "=============================================="
    echo "🚀 地図XMLビューア サーバーを起動しています..."
    echo "フォルダ: $DIR/public"
    echo "ポート: $PORT"
    
    # Start python server in background
    cd "$DIR/public"
    python3 -m http.server $PORT > /dev/null 2>&1 &
    SERVER_PID=$!
    cd "$DIR"
    
    # Wait a moment for server to bind
    sleep 1
    
    echo "✅ サーバーが正常に起動しました！ (PID: $SERVER_PID)"
    echo "=============================================="
fi

# Attempt to open browser on Windows host
# WSL allows calling Windows executables/commands to interact with the host
if command -v cmd.exe >/dev/null 2>&1; then
    echo "🌐 Windowsのブラウザを開いています..."
    cmd.exe /c start http://localhost:$PORT/ >/dev/null 2>&1
else
    echo "🌐 ブラウザで以下のURLを開いてください:"
    echo "👉 http://localhost:$PORT/"
fi

echo ""
echo "💡 サーバーを停止するには、以下のコマンドを実行してください:"
echo "   kill \$(lsof -t -i:$PORT)  または  kill -9 $SERVER_PID"
echo "=============================================="
