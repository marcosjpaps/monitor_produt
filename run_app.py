"""Inicializa todos os módulos e abre o portal no navegador."""
import os, sys, subprocess, threading, webbrowser, urllib.request, time
from pathlib import Path
BASE=Path(__file__).resolve().parent

def open_browser(port):
    for _ in range(120):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as r:
                if r.status==200: webbrowser.open(f'http://127.0.0.1:{port}/');return
        except Exception: pass
        time.sleep(.5)

def main():
    env=os.environ.copy();env['PYTHON_EXECUTABLE']=sys.executable
    port=env.get('PORT','3000')
    print(f'Monitor Agrícola — http://127.0.0.1:{port}')
    threading.Thread(target=open_browser,args=(port,),daemon=True).start()
    try: subprocess.run(['node','server.js'],cwd=BASE,env=env,check=True)
    except FileNotFoundError: print('Instale Node.js 22.13 ou superior.');return 1
    except subprocess.CalledProcessError as e: return e.returncode
    except KeyboardInterrupt: return 0
    return 0
if __name__=='__main__': sys.exit(main())
