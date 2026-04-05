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
2. **Mapa árbol** (crítico visual)
3. **Portadas Autores** (quick fix)
4. **Tabs móvil desplegable** (UX móvil)
5. **Eliminar "Leer análisis" cabecera** (simplificación)
6. **Reorganizar TTS por bloques** (cambio más complejo)

---

## 🎯 Archivos que necesitarán cambios

| Archivo | Cambio 2 | Cambio 3 | Cambio 4 | Cambio 5 | Cambio 6 |
|---------|----------|----------|----------|----------|----------|
| `MindMap.jsx` | ✅ | - | - | - | - |
| `AuthorsPage.jsx` | - | ✅ | - | - | - |
| `BookPage.jsx` | - | - | ✅ | ✅ | ✅ |
| `BookPage.css` | - | - | ✅ | ✅ | ✅ |

---

## ⚠️ Consideraciones técnicas

### Cambio 6 (Reorganizar TTS):
- **Más complejo:** Requiere refactor significativo del estado TTS
- **Beneficio:** Cada tab es independiente, más claro para el usuario
- **Riesgo:** Posible confusión si dos tabs tienen reproducciones distintas a medias
- **Mitigation:** Al cambiar de tab, pausar automáticamente la reproducción activa

### Cambio 2 (Mapa árbol):
- Requiere cambiar lógica de posicionamiento D3.js
- Layouts posibles: `d3.tree()` horizontal o vertical
- Mantener zoom, pan y colapsar/expandir

### Cambio 4 (Tabs móvil):
- Detectar breakpoint con media query
- Asegurar que el select cambia correctamente entre tabs
- Mantener estado de tab activo

---

## 🚀 Estado actual

**Versión actual:** v2.0.2 + Fix Referencias
**Pendientes:** 5 cambios más
**Estimación:** ~3-4 horas para completar todos los cambios
**Prioridad:** Media-Alta (mejoras UX importantes)

---

**Próximo paso:** Continuar con implementación del cambio 2 (Mapa-árbol)
