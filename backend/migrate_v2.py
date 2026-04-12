import sqlite3
import os
import glob

# Configuración básica (Ajustar si la ruta en Synology es distinta)
DATABASE_DIR = "/data/databases"

def migrate_user_dbs():
    db_files = glob.glob(os.path.join(DATABASE_DIR, "user_*.db"))
    
    if not db_files:
        print(f"No se encontraron bases de datos de usuario en {DATABASE_DIR}")
        return

    cols_to_add = [
        ("phase4_done", "BOOLEAN DEFAULT 0"),
        ("phase5_done", "BOOLEAN DEFAULT 0"),
        ("phase6_done", "BOOLEAN DEFAULT 0")
    ]

    for db_file in db_files:
        print(f"Procesando: {os.path.basename(db_file)}...")
        try:
            conn = sqlite3.connect(db_file)
            cursor = conn.cursor()
            
            # Obtener columnas actuales
            cursor.execute("PRAGMA table_info(books)")
            current_cols = [col[1] for col in cursor.fetchall()]
            
            for col_name, col_type in cols_to_add:
                if col_name not in current_cols:
                    print(f"  + Añadiendo columna: {col_name}")
                    cursor.execute(f"ALTER TABLE books ADD COLUMN {col_name} {col_type}")
                else:
                    print(f"  - Columna {col_name} ya existe.")
            
            conn.commit()
            conn.close()
            print(f"✓ {os.path.basename(db_file)} actualizado con éxito.")
        except Exception as e:
            print(f"✗ Error procesando {db_file}: {e}")

if __name__ == "__main__":
    migrate_user_dbs()
    print("\nMigración completada.")
