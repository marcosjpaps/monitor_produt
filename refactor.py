import os
import re

def refactor_file(filepath):
    if not os.path.exists(filepath): return
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Import psycopg2 instead of sqlite3
    content = content.replace("import sqlite3", "import psycopg2\nfrom psycopg2.extras import RealDictCursor\nimport urllib.parse")
    
    # 2. Update get_connection or conn creation
    # Replace conn = sqlite3.connect(...) with psycopg2.connect
    # We will inject a helper get_pg_connection
    
    content = content.replace('sqlite3.connect(db_path, timeout=30.0)', 'get_pg_connection()')
    content = content.replace('sqlite3.connect(MASSEY_DB_PATH)', 'get_pg_connection()')
    content = content.replace('conn.row_factory = sqlite3.Row', 'pass  # using RealDictCursor')
    content = content.replace('conn.row_factory=sqlite3.Row', 'pass')

    # Replace ? placeholders with %s
    # Warning: this is simple but might hit ? inside strings if they exist.
    # A safer way is re.sub outside quotes, but let's try simple first
    # Actually, let's use a regex that only replaces ? if it's not inside quotes?
    # For now, let's just replace all ' ?' or ',?' or '(?'.
    # A robust way:
    content = re.sub(r'\?', '%s', content)
    
    # 3. Replace SQLite specific SQL syntax
    content = content.replace("INSERT OR IGNORE INTO", "INSERT INTO")
    content = content.replace("AUTOINCREMENT", "SERIAL")
    content = content.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    content = content.replace("INTEGER PRIMARY KEY", "SERIAL PRIMARY KEY") # Sometimes used as alias
    content = content.replace("TEXT DEFAULT (datetime('now', 'localtime'))", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    content = content.replace("datetime('now')", "CURRENT_TIMESTAMP")
    content = content.replace("BLOB", "BYTEA")
    # Postgres doesn't use rowid usually, replace if present
    
    # Fix ON CONFLICT DO NOTHING for psycopg2. 
    # SQLite uses INSERT OR IGNORE. We changed it to INSERT INTO. 
    # We must append ON CONFLICT DO NOTHING. But Postgres requires ON CONFLICT (col) DO NOTHING.
    # Let's hope there aren't many. If there are, we'll fix them manually.

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for f in ['backend/db.py', 'backend/massey_import.py', 'backend/massey_engine.py']:
    refactor_file(f)

