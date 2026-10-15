"""Histórico transacional de importações e fonte durável dos arquivos AgGPS.

Os registros agrícolas de JD e Massey continuam nas tabelas próprias. Somente
os arquivos AgGPS Jacto precisam ser reidratados em /tmp após cold start.
"""
from __future__ import annotations

import hashlib
import io
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from .archive_utils import safe_extract, safe_name, extract_rar
from .pg_adapter import connect as pg_connect

MODULES = {"johndeere", "jacto", "massey"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_REHYDRATE_FILES = 1500


def init_import_store():
    with pg_connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS monitor_imports (
                id TEXT PRIMARY KEY,
                module TEXT NOT NULL,
                filename TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                bytes_size BIGINT NOT NULL,
                records_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'imported',
                imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                archived_at TEXT,
                file_data BYTEA,
                UNIQUE(module, sha256)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS monitor_imports_date_idx ON monitor_imports(imported_at)")
        conn.commit()


def lookup_import(module: str, digest: str):
    with pg_connect() as conn:
        row = conn.execute(
            "SELECT id,filename,status,archived_at,records_count FROM monitor_imports WHERE module=? AND sha256=?",
            (module, digest),
        ).fetchone()
        return dict(row) if row else None


def register_import(module: str, filename: str, raw: bytes, count: int, store_binary=False):
    import uuid
    if module not in MODULES:
        raise ValueError("Módulo de importação inválido")
    filename = safe_name(filename)
    digest = hashlib.sha256(raw).hexdigest()
    uid = str(uuid.uuid4())
    with pg_connect() as conn:
        conn.execute(
            """INSERT INTO monitor_imports(
                 id,module,filename,sha256,bytes_size,records_count,status,file_data
               ) VALUES(?,?,?,?,?,?,'imported',?)
               ON CONFLICT(module,sha256) DO NOTHING""",
            (uid, module, filename, digest, len(raw), max(0, int(count)),
             raw if store_binary else None),
        )
        row = conn.execute("SELECT id FROM monitor_imports WHERE module=? AND sha256=?",
                           (module, digest)).fetchone()
        conn.commit()
    return {"id": row["id"], "sha256": digest, "new": row["id"] == uid}


def list_imports(module: str | None, archived: bool, limit: int, offset: int):
    if module is not None and module not in MODULES:
        raise ValueError("Módulo inválido")
    filters = "WHERE archived_at IS NOT NULL" if archived else "WHERE archived_at IS NULL"
    params = []
    if module:
        filters += " AND module=?"
        params.append(module)
    with pg_connect() as conn:
        rows = conn.execute(
            f"""SELECT id,module,filename,bytes_size,records_count,status,imported_at,archived_at
               FROM monitor_imports {filters}
               ORDER BY imported_at DESC, id DESC LIMIT ? OFFSET ?""",
            tuple(params + [limit, offset]),
        ).fetchall()
        total = conn.execute(f"SELECT COUNT(*) AS total FROM monitor_imports {filters}",
                             tuple(params)).fetchone()
    return {"items": [dict(r) for r in rows], "total": int(total["total"]),
            "limit": limit, "offset": offset}


def change_archive(item_id: str, archived: bool):
    with pg_connect() as conn:
        row = conn.execute("SELECT id,module,archived_at FROM monitor_imports WHERE id=?",
                           (item_id,)).fetchone()
        if not row:
            return None
        conn.execute(
            ("UPDATE monitor_imports SET archived_at=CURRENT_TIMESTAMP WHERE id=?"
             if archived else "UPDATE monitor_imports SET archived_at=NULL WHERE id=?"),
            (item_id,),
        )
        conn.commit()
    return {"id": item_id, "module": row["module"], "archived": archived}


def hydrate_jacto_imports(*, reset: bool = False):
    """Reconstrói temporariamente o diretório de leitura do Jacto a partir do DB.
    Em nuvem, o diretório é efêmero; o PostgreSQL é a fonte persistente.
    """
    if not os.environ.get("VERCEL"):
        return {"hydrated": 0, "mode": "local"}
    from .aggps_parser import _find_aggps_dir, get_active_aggps_path
    root = Path(_find_aggps_dir(get_active_aggps_path())) / "Importados_Jacto"
    root.mkdir(parents=True, exist_ok=True)
    if reset and root.exists():
        # Limita a limpeza ao diretório temporário, nunca ao banco de dados.
        if str(root.resolve()).startswith(str(Path(tempfile.gettempdir()).resolve()) + os.sep):
            shutil.rmtree(root)
            root.mkdir(parents=True, exist_ok=True)
    with pg_connect() as conn:
        rows = conn.execute(
            """SELECT filename, sha256, file_data FROM monitor_imports
               WHERE module='jacto' AND status='imported'
                 AND archived_at IS NULL AND file_data IS NOT NULL
               ORDER BY imported_at ASC LIMIT ?""",
            (MAX_REHYDRATE_FILES,),
        ).fetchall()
    hydrated = 0
    for row in rows:
        filename = safe_name(row["filename"])
        digest = row["sha256"]
        raw = bytes(row["file_data"])
        ext = Path(filename).suffix.lower()
        if ext in (".zip", ".rar"):
            target = root / digest[:24]
            target.mkdir(parents=True, exist_ok=True)
            if ext == ".zip":
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    safe_extract(archive, target)
            else:
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "upload.rar"
                    path.write_bytes(raw)
                    extract_rar(path, target)
        elif ext in (".shp", ".dbf", ".shx", ".prj", ".cpg", ".xml", ".kml"):
            target = root / "Diretos" / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        hydrated += 1
    return {"hydrated": hydrated, "mode": "cloud"}
