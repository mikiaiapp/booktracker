import sqlite3
import os

def check_users():
    db_path = "/data/databases/global.db"
    if not os.path.exists(db_path):
        print(f"[!] ERROR: La base de datos no existe en {db_path}")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name, email FROM users")
        members = cursor.fetchall()
        
        if not members:
            print("[!] ADVERTENCIA: La base de datos está VACÍA (0 usuarios).")
        else:
            print(f"[✓] Encontrados {len(members)} usuarios:")
            for m in members:
                print(f"    - {m[0]} ({m[1]})")
        
        conn.close()
    except Exception as e:
        print(f"[!] Error leyendo la base de datos: {e}")

if __name__ == "__main__":
    check_users()
