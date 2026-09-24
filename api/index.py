"""
Vercel Serverless Entry Point — AgroTelemetry Monitor
Compatible with Vercel Python Runtime (Python 3.12)
"""
import sys
import os

# Adiciona o diretório pai ao path para importar o backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.main import app  # noqa: F401 — Vercel usa 'app' como handler ASGI
