@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python run_app.py
) else (
  python run_app.py
)
pause
