import psycopg2
from psycopg2.extras import RealDictCursor
import os
import re

# Credenciais devem vir do ambiente, jamais do código ou de valores padrão.
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")

def convert_sqlite_to_pg_sql(sql):
    if "PRAGMA" in sql.upper():
        return ""
    
    # Substituir ? por %s (Fora de strings. Aqui fazemos simples assumindo queries limpas)
    sql = sql.replace("?", "%s")
    
    # Tipos do SQLite para Postgres
    sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    sql = sql.replace("INTEGER PRIMARY KEY", "SERIAL PRIMARY KEY")
    sql = sql.replace("TEXT DEFAULT (datetime('now', 'localtime'))", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    sql = sql.replace("REAL", "DOUBLE PRECISION")
    sql = sql.replace("BLOB", "BYTEA")
    sql = re.sub(r"\btimestamp_ms\s+INTEGER", "timestamp_ms BIGINT", sql)
    
    # Tratar o INSERT OR IGNORE INTO
    if "INSERT OR IGNORE INTO" in sql.upper():
        sql = sql.replace("INSERT OR IGNORE INTO", "INSERT INTO")
        if "ON CONFLICT" not in sql.upper():
            # Tentar adivinhar a chave primária pelo ID
            sql += " ON CONFLICT (id) DO NOTHING"
            
    return sql

class PgCursor:
    def __init__(self, cur):
        self.cur = cur

    def execute(self, sql, params=None):
        sql = convert_sqlite_to_pg_sql(sql)
        if not sql.strip(): return self
        try:
            if params is None:
                self.cur.execute(sql)
            else:
                self.cur.execute(sql, params)
        except Exception as e:
            if "already exists" in str(e):
                return self
            print(f"Error executing: {sql}\nException: {e}")
            raise
        return self

    def executemany(self, sql, param_list):
        sql = convert_sqlite_to_pg_sql(sql)
        if not sql.strip(): return self
        try:
            self.cur.executemany(sql, param_list)
        except Exception as e:
            if "already exists" in str(e):
                return self
            print(f"Error executing many: {sql}\nException: {e}")
            raise
        return self

    def fetchone(self):
        row = self.cur.fetchone()
        return dict(row) if row else None

    def fetchall(self):
        return [dict(r) for r in self.cur.fetchall()]

    def __iter__(self):
        try:
            # PRAGMA in postgres returns nothing if ignored
            rows = self.cur.fetchall()
            return iter([dict(r) for r in rows])
        except Exception:
            return iter([])

    @property
    def rowcount(self):
        return self.cur.rowcount

class PgConnection:
    def __init__(self, conn):
        self.conn = conn
        self.conn.autocommit = False

    def cursor(self):
        return PgCursor(self.conn.cursor(cursor_factory=RealDictCursor))

    def execute(self, sql, params=None):
        cur = self.cursor()
        return cur.execute(sql, params)

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is None:
                self.commit()
            else:
                self.conn.rollback()
        finally:
            self.conn.close()

def connect(db_path=None):
    # Ignora o db_path do SQLite e conecta no Postgres
    url = DATABASE_URL or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL ou POSTGRES_URL não configurada.")
    conn = psycopg2.connect(url)
    return PgConnection(conn)
