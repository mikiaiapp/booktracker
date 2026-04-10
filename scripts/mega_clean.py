import os

def mega_clean(fpath):
    with open(fpath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    new_lines = []
    for line in lines:
        # Si la línea tiene algo como "... "Text" ...", está rota.
        # Vamos a intentar una solución drástica: si hay comillas dobles escapadas o dobles-dobles, las arreglamos.
        # Pero lo más seguro es arreglar los decoradores que vimos en el log.
        new_line = line.replace('\\"', '"') 
        # Si la línea ahora tiene 4 o más comillas dobles, es sospechosa.
        if new_line.count('"') >= 4 and '@router' not in new_line:
            # Intentamos envolver la línea en comillas simples si es una cadena
            pass 
        new_lines.append(new_line)
    
    with open(fpath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

# Archivos que sabemos que tienen strings complejos
files = [
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/api/analysis.py',
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/workers/tasks.py',
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/workers/queue_manager.py',
    r'v:/mikiaiapp/booktracker/booktracker/backend/app/services/ai_analyzer.py'
]

for f in files:
     mega_clean(f)
