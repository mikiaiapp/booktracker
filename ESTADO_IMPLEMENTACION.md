# 📋 Estado de implementación - Nuevas mejoras v2.0.3

## ✅ Implementado

### 1. Fix: Referencias del libro
- **Problema:** Al pulsar referencias se iba a pantalla en blanco
- **Solución:** Creado componente `RefsTab` que muestra bibliografía del autor
- **Resultado:** Grid con portadas y datos de otros libros del autor
- **Archivos:** `BookPage.jsx` (+40 líneas), `BookPage.css` (+65 líneas)

---

## 🔄 En progreso / Pendiente

### 2. Mapa mental en formato árbol (NO radial)
**Requerimiento:**
- Cambiar de layout radial a layout árbol vertical/horizontal
- Mantener funcionalidad de colapsar/expandir
- Mejorar navegabilidad

**Plan:**
```javascript
// Cambiar de:
const treeLayout = d3.tree().size([2 * Math.PI, radius])

// A:
const treeLayout = d3.tree().size([width, height])
// Con orientación vertical u horizontal
```

### 3. Igualar portadas en Bibliografía completa (Autores) con "Otras obras del autor"
**Problema actual:**
- En página Autores → Bibliografía completa: algunos libros sin portada
- En ficha de libro → Otras obras del autor: mismas obras CON portada

**Causa:**
- Ya se implementó en v2.0.1 pero puede haber casos edge
- Verificar que `AuthorsPage.jsx` pasa todos los metadatos correctamente

**Solución:**
- Revisar flujo completo de datos en AuthorsPage
- Asegurar que `cover_url`, `year`, `synopsis` se pasan siempre

### 4. Barra horizontal móvil → Desplegable
**Requerimiento:**
- En móvil vertical, sustituir scroll horizontal de tabs
- Por un selector desplegable (dropdown/select)
- Opciones: Ficha, Capítulos, Personajes, Resumen global, Mapa mental, Podcast, Referencias

**Implementación sugerida:**
```jsx
// Media query en BookPage.css
@media (max-width: 768px) {
  .tabs-nav { display: none; }
  .tabs-select { display: block; }
}

// Nuevo componente
<select className="tabs-select" value={tab} onChange={(e) => setTab(e.target.value)}>
  <option value="info">📖 Ficha</option>
  <option value="chapters">📑 Capítulos</option>
  <option value="characters">👤 Personajes</option>
  ...
</select>
```

### 5. Eliminar botón "Leer análisis" de cabecera
**Requerimiento:**
- Quitar botón "Leer análisis" / "Continuar" / "Pausar" de hero section
- En su lugar:
  - Si hay reproducción a medias: Botón "Continuar reproducción"
  - Botón "Stop" con confirmación siempre visible si hay reproducción activa o pausada

**Lógica actual a cambiar:**
```javascript
// ANTES: Hero con Play/Pausa/Stop
<div className="hero-tts">
  <button onClick={() => {...}}>
    {ttsPlaying ? 'Pausar' : 'Leer análisis'}
  </button>
  {ttsChapter && <button>Stop</button>}
</div>

// DESPUÉS: Solo si hay reproducción a medias
{(ttsChapter || hasSavedPos()) && (
  <div className="hero-tts-resume">
    <button>Continuar reproducción</button>
    <button>Stop</button>
  </div>
)}
```

### 6. Reorganizar reproducciones por bloques

**Cambio conceptual importante:**
- ANTES: Un sistema TTS global que lee todo secuencialmente
- DESPUÉS: Tres sistemas TTS independientes por bloque

#### Bloque 1: Ficha
**Ubicación:** Tab "Ficha" (InfoTab)
**Contenido TTS:**
- Sinopsis
- Sobre el autor (biografía)

**Controles:**
- Solo botón ▶ Play (NO "reproducir desde aquí")
- Lee la sinopsis primero, luego la biografía
- Pausa y Stop independientes del resto

#### Bloque 2: Capítulos  
**Ubicación:** Tab "Capítulos" (ChaptersTab)
**Contenido TTS:**
- Cada capítulo (título + resumen + eventos clave)

**Controles por capítulo:**
- Botón ▶ Play (reproduce solo ese capítulo)
- Botón ⏯ "Reproducir desde aquí" (desde ese capítulo hasta el final)
- Pausa y Stop compartidos entre todos los capítulos

#### Bloque 3: Personajes
**Ubicación:** Tab "Personajes" (CharactersTab)
**Contenido TTS:**
- Cada personaje (nombre + descripción completa)

**Controles por personaje:**
- Botón ▶ Play (reproduce solo ese personaje)
- Botón ⏯ "Reproducir desde aquí" (desde ese personaje hasta el final)
- Pausa y Stop compartidos entre todos los personajes

**Implementación sugerida:**
```javascript
// Estado separado para cada bloque
const [ttsInfoPlaying, setTtsInfoPlaying] = useState(false)
const [ttsChaptersPlaying, setTtsChaptersPlaying] = useState(false)
const [ttsCharsPlaying, setTtsCharsPlaying] = useState(false)

// Funciones por bloque
const playInfo = () => { /* Lee sinopsis + bio */ }
const playChapter = (ch) => { /* Lee un capítulo */ }
const playFromChapter = (ch, chapters) => { /* Lee desde capítulo */ }
const playCharacter = (char) => { /* Ya existe */ }
const playFromCharacter = (char, characters) => { /* Ya existe */ }

// Solo 1 bloque puede estar activo a la vez
const stopAllTTS = () => {
  stopInfoTTS()
  stopChaptersTTS()
  stopCharsTTS()
}
```

---

## 📝 Orden de implementación sugerido

1. ✅ **Fix Referencias** (HECHO)
2. ✅ **Sistema de Detección de Duplicados** (HECHO)
   - Implementada validación estricta Título + Autor en el Worker (Fase 1).
   - Añadido banner de advertencia en `BookPage.jsx` con opciones de ignorar o eliminar.
3. ✅ **Branding y Favicon** (HECHO)
   - Generación de logo premium (libro dorado sobre fondo negro).
   - Configuración de `favicon.png` y actualización de `index.html`.
   - Inclusión del logo animado en la barra lateral de escritorio (ahora al doble de tamaño: 160px).
4. ✅ **Estabilidad del Backend (SOPORTE PRODUCTO)** (HECHO)
   - Corregido error de indentación en `books.py`.
   - Corregido Error de nombre (`NameError`) en `queue_manager.py` (parámetro `title`).
   - Resolución de Error **502 Bad Gateway** en producción.
   - Sincronización automática de cambios críticos a GitHub.
5. **Mapa árbol** (crítico visual - Pendiente)
6. **Portadas Autores** (quick fix - Pendiente)
7. ✅ **PWA e Instalación móvil** (HECHO)
   - Creado `manifest.json` con branding premium.
   - Implementado Service Worker (`sw.js`) para soporte offline.
   - Añadidos meta-tags para iOS/Safari y SEO/OpenGraph.
   - Sincronizado con repositorio GitHub para despliegue automático.
8. **Eliminar "Leer análisis" cabecera** (simplificación - Pendiente)
9. **Reorganizar TTS por bloques** (cambio más complejo - Pendiente)

---

## 🎯 Archivos que necesitarán cambios (Actualizado)

| Archivo | Cambio 4 | Cambio 5 | Cambio 6 | Cambio 7 | Cambio 8 |
|---------|----------|----------|----------|----------|----------|
| `MindMap.jsx` | ✅ | - | - | - | - |
| `AuthorsPage.jsx` | - | ✅ | - | - | - |
| `BookPage.jsx` | - | - | ✅ | ✅ | ✅ |
| `BookPage.css` | - | - | ✅ | ✅ | ✅ |

---

- Mantener zoom, pan y colapsar/expandir

### Cambio 4 (Tabs móvil):
- Detectar breakpoint con media query
- Asegurar que el select cambia correctamente entre tabs
- Mantener estado de tab activo

---

## 🚀 Estado actual

**Versión actual:** v2.0.3 (Estable)
**Pendientes:** 5 cambios más
**Estimación:** ~3-4 horas para completar todos los cambios
**Prioridad:** Media-Alta (mejoras UX importantes)

---

**Próximo paso:** Continuar con implementación del cambio 2 (Mapa-árbol)
