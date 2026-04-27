import os

def clean_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace \" with " (but only if it's not preceded by a backslash that should be there?)
    # Actually, the error shows \"\"\" being converted from """
    # Let's be careful. The log says \"\"\"
    # In Python, \" is an escaped quote inside a string.
    # But outside a string, it's a SyntaxError.
    
    new_content = content.replace('\\"', '"')
    
    if new_content != content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

root_dir = r"v:\mikiaiapp\booktracker\backend\app"
for root, dirs, files in os.walk(root_dir):
    for file in files:
        if file.endswith(".py"):
            p = os.path.join(root, file)
            if clean_file(p):
                print(f"Cleaned: {p}")
