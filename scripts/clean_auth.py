import os

# Archivos críticos para auth
targets = [
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/api/auth.py',
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/main.py',
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/core/database.py',
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/core/security.py'
]

for fpath in targets:
    if os.path.exists(fpath):
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        if '\\"' in content:
            new_content = content.replace('\\"', '"')
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Limpiado: {fpath}")
        else:
            print(f"Ya estaba limpio: {fpath}")
