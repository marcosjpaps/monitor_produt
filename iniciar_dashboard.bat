@echo off
title Monitor de Produtividade John Deere G5
echo =======================================================================
echo  INICIANDO MONITOR DE TELEMETRIA AGRICOLA JOHN DEERE G5 (.JDL)
echo =======================================================================

cd /d "%~dp0"

if exist "C:\Program Files\QGIS 3.44.11\apps\Python312\python.exe" (
    "C:\Program Files\QGIS 3.44.11\apps\Python312\python.exe" run_app.py
) else (
    python run_app.py
)

pause
