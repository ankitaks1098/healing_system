#!/bin/bash
set -e

echo "Starting backend server..."
cd server
node index.js &
BACKEND_PID=$!
cd ..

echo "Starting frontend..."
cd app
exec pnpm run dev -- --port 5000 --host
