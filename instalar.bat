@echo off
cd /d "%~dp0"
echo Instalando o Monitor Agricola...
node --version || goto erro
python --version || goto erro
call npm ci || goto erro
python -m venv .venv || goto erro
.venv\Scripts\python -m pip install -r backend\requirements.txt || goto erro
echo Instalacao concluida. Execute iniciar_dashboard.bat
pause
exit /b 0
:erro
echo A instalacao falhou. Confira a mensagem acima. Requer Node 22.13+ e Python 3.10+.
pause
exit /b 1
