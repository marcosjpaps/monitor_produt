"""Extração com limite de tamanho e proteção de caminhos."""
from pathlib import Path
import zipfile

def safe_name(name):
    text=(name or '').replace('\\','/')
    parts=text.split('/')
    if not text or text.startswith('/') or any(p in ('..','') for p in parts) or ':' in text or any(p.startswith('.') for p in parts):
        raise ValueError('Nome ou caminho de arquivo inválido')
    return text

def safe_extract(archive, target):
    root=Path(target).resolve()
    infos=archive.infolist()
    if len(infos)>10000 or sum(i.file_size for i in infos)>500*1024*1024:
        raise ValueError('Pacote excede 10.000 arquivos ou 500 MB descompactados')
    for info in infos:
        name=info.filename.rstrip('/')
        if not name: continue
        safe_name(name)
        mode=(getattr(info,'external_attr',0)>>16)&0o170000
        if mode==0o120000 or (hasattr(info,'is_symlink') and info.is_symlink()):
            raise ValueError('Links simbólicos não são permitidos')
        path=(root/name).resolve()
        if not path.is_relative_to(root): raise ValueError('Caminho fora da pasta de importação')
    archive.extractall(root)

def extract_rar(file, target):
    import rarfile
    with rarfile.RarFile(file) as archive: safe_extract(archive,target)
