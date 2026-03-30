# 🐛 Fix: Portadas faltantes en Bibliografía de Autores

## Problema resuelto

En la página de **Autores**, la sección "Bibliografía completa" mostraba libros sin portada (placeholder con icono +), mientras que en la sección "Otras obras del autor" dentro de la ficha del libro, las mismas obras sí tenían portada.

## Causa

Al crear fichas shell desde la bibliografía, solo se guardaban **título, autor e ISBN**, pero se ignoraban los metadatos adicionales (`year`, `cover_url`, `synopsis`) que ya estaban disponibles en la respuesta de Google Books.

## Solución implementada

### 1. Backend - `backend/app/api/books.py`

**Antes:**
```python
class CreateShellRequest(BaseModel):
    title: str
    author: Optional[str] = None
    isbn: Optional[str] = None
```

**Después:**
```python
class CreateShellRequest(BaseModel):
    title: str
    author: Optional[str] = None
    isbn: Optional[str] = None
    year: Optional[int] = None
    cover_url: Optional[str] = None
    synopsis: Optional[str] = None
```

**Cambio en el endpoint:**
```python
book = Book(
    id=book_id,
    title=req.title,
    author=req.author,
    isbn=req.isbn,
    year=req.year,              # ✅ Nuevo
    cover_url=req.cover_url,    # ✅ Nuevo
    synopsis=req.synopsis,      # ✅ Nuevo
    file_type=None,
    file_path=None,
    status="shell",
    phase1_done=False,
)
```

### 2. Frontend API - `frontend/src/utils/api.js`

**Antes:**
```javascript
create: (title, author, isbn = null) => 
  api.post('/books/shell', { title, author, isbn })
```

**Después:**
```javascript
create: (title, author, isbn = null, year = null, cover_url = null, synopsis = null) => 
  api.post('/books/shell', { title, author, isbn, year, cover_url, synopsis })
```

### 3. Frontend Autores - `frontend/src/pages/AuthorsPage.jsx`

**Cambio en `handleAddShell`:**
```javascript
const handleAddShell = async (item, authorName) => {
  const title = typeof item === 'string' ? item : item.title
  const isbn = typeof item === 'string' ? null : (item.isbn || null)
  const year = typeof item === 'string' ? null : (item.year || null)        // ✅ Nuevo
  const cover_url = typeof item === 'string' ? null : (item.cover_url || null) // ✅ Nuevo
  const synopsis = typeof item === 'string' ? null : (item.synopsis || null)   // ✅ Nuevo
  
  const { data } = await shellAPI.create(title, authorName, isbn, year, cover_url, synopsis)
  // ...
}
```

**Cambio en visualización de libros no añadidos:**
```jsx
<div className="biblio-cover-img">
  {cover_url ? (
    <img src={cover_url} alt={title} />  {/* ✅ Mostrar portada si existe */}
  ) : (
    <div className="biblio-cover-ph">
      <BookOpen size={18} strokeWidth={1} />
    </div>
  )}
  <button className="biblio-add-btn" /* ... */>
    {isCreating ? '…' : <Plus size={16} />}
  </button>
</div>
<span className="biblio-cover-title">{title}</span>
{year && <span className="biblio-cover-year">{year}</span>}  {/* ✅ Mostrar año */}
```

## Resultado

### Antes del fix
```
Bibliografía completa (página Autores):
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│             │  │             │  │             │
│      📖     │  │      📖     │  │      📖     │  ← Placeholders
│             │  │             │  │             │
│     [+]     │  │     [+]     │  │     [+]     │
└─────────────┘  └─────────────┘  └─────────────┘
 La Novia Gitana   El Clan         Las Madres

Otras obras del autor (ficha de libro):
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [PORTADA]  │  │  [PORTADA]  │  │  [PORTADA]  │  ← Portadas correctas
│             │  │             │  │             │
└─────────────┘  └─────────────┘  └─────────────┘
 La Novia Gitana   El Clan         Las Madres
```

### Después del fix
```
Bibliografía completa (página Autores):
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [PORTADA]  │  │  [PORTADA]  │  │  [PORTADA]  │  ← ✅ Portadas correctas
│             │  │             │  │             │
│     [+]     │  │     [+]     │  │     [+]     │
└─────────────┘  └─────────────┘  └─────────────┘
 La Novia Gitana   El Clan         Las Madres
 2025              2024            2025           ← ✅ Años mostrados

Otras obras del autor (ficha de libro):
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [PORTADA]  │  │  [PORTADA]  │  │  [PORTADA]  │  ← Portadas correctas
│             │  │             │  │             │
└─────────────┘  └─────────────┘  └─────────────┘
 La Novia Gitana   El Clan         Las Madres
```

## Beneficios adicionales

1. **Sinopsis inmediata:** Las fichas shell tienen sinopsis desde el momento de creación
2. **Año visible:** Se muestra el año de publicación en la bibliografía
3. **Mejor UX:** El usuario ve las portadas antes de añadir el libro
4. **Menos carga al worker:** `fetch_shell_metadata` tiene menos trabajo porque ya hay datos iniciales

## Flujo completo

1. **Usuario abre página de Autores** → Se carga bibliografía desde Google Books con metadatos completos
2. **Usuario ve libros no añadidos** → Portadas y años visibles directamente
3. **Usuario hace clic en [+]** → Se crea shell con todos los metadatos
4. **Worker procesa en background** → Descarga portada localmente, completa datos faltantes
5. **Resultado final** → Libro con portada local, sinopsis y todos los metadatos

## Testing

Para verificar el fix:

1. Ir a página de **Autores**
2. Seleccionar un autor con libros en la bibliografía
3. Verificar que los libros **no añadidos aún** (con botón [+]) muestran:
   - ✅ Portada (si existe en Google Books)
   - ✅ Año de publicación
4. Hacer clic en [+] para añadir uno
5. Verificar que la ficha shell creada tiene:
   - ✅ Portada desde el inicio
   - ✅ Año correcto
   - ✅ Sinopsis

## Compatibilidad

- ✅ **Retrocompatible:** Funciona con bibliografías existentes
- ✅ **Sin migración de BD:** Los campos ya existen en el modelo
- ✅ **Sin breaking changes:** Los campos opcionales no afectan funcionalidad anterior

## Archivos modificados

```
backend/app/api/books.py              (+6 líneas)
frontend/src/utils/api.js             (+1 línea)
frontend/src/pages/AuthorsPage.jsx    (+7 líneas)
```

**Total:** 3 archivos, ~15 líneas modificadas

---

**Versión:** BookTracker v2.0.1  
**Fecha:** 30 de marzo de 2026  
**Tipo:** Bugfix  
**Prioridad:** Media  
**Impacto:** UX mejorada en página de Autores
