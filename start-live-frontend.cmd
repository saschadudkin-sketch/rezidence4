@echo off
cd /d "C:\Users\Alexandr\OneDrive\Documents\New project\rezidence4\frontend"
set VITE_RUNTIME_MODE=live
set VITE_API_URL=http://127.0.0.1:3001
npm.cmd run dev -- --host 127.0.0.1 --port 5173
