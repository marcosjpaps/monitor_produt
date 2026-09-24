#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Inicializador da Aplicação Telemetria John Deere G5
Inicia o servidor FastAPI/Uvicorn e abre automaticamente o Dashboard no navegador.
"""

import os
import sys
import time
import threading
import webbrowser

# Garante que o diretório raiz esteja no sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import uvicorn

def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:8000"
    print(f"\n[INFO] Abrindo Dashboard de Telemetria no navegador: {url}")
    webbrowser.open(url)

def main():
    print("=" * 80)
    print(" INICIANDO MONITOR DE TELEMETRIA JOHN DEERE G5")
    print(" Servidor: http://127.0.0.1:8000")
    print("=" * 80)

    # Inicia abertura do navegador em segundo plano
    threading.Thread(target=open_browser, daemon=True).start()

    # Executa o servidor FastAPI com Uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, log_level="info")

if __name__ == "__main__":
    main()
