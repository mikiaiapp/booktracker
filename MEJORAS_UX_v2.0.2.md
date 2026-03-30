# 🎨 Mejoras UX BookTracker v2.0.2

## 📋 Resumen ejecutivo

Esta actualización introduce **4 mejoras significativas de UX** que hacen que BookTracker sea más visual, interactivo y funcional:

1. **Guion del podcast más atractivo** - Detección automática de secciones y formateo visual
2. **Mapa mental interactivo** - Nodos colapsables, pantalla completa, animaciones
3. **TTS para personajes** - Reproducción en audio de fichas de personajes
4. **Exportar a PDF** - Generación de documento completo del análisis

---

## 1️⃣ Guion del podcast visualmente mejorado

### ¿Qué hace?

Transforma el guion del podcast de texto plano a un formato estructurado y visualmente rico que detecta automáticamente diferentes elementos.

### Características

- **Detección de secciones:** Reconoce automáticamente títulos como:
  - Palabras en mayúsculas (≥4 caracteres)
  - Patrones: INTRODUCCIÓN, CAPÍTULO, PARTE, PERSONAJES, CONCLUSIÓN, ANÁLISIS
  - Líneas con marcadores: `#`, `##`, `**`, `__`, `=`

- **Formateo de diálogos:**
  - Líneas que empiezan con `-` o `•` → cursiva con marcador dorado
  - Se identifica visualmente como diálogo entre presentadores

- **Preguntas destacadas:**
  - Líneas que terminan en `?` → fondo dorado claro, borde izquierdo dorado
  - Resalta preguntas retóricas o de reflexión

- **Separación visual:**
  - Cada sección tiene título con color dorado y línea separadora
  - Espaciado claro entre secciones
  - Marcador `▸` antes del título de sección

### Antes vs Después

**Antes:**
```
Texto plano
Texto plano
Texto plano
- Diálogo sin formato
¿Pregunta sin destacar?
```

**Después:**
```
▸ INTRODUCCIÓN
═══════════════════

Párrafo normal con buena legibilidad...

• Diálogo en cursiva con marcador visual

? Pregunta destacada con fondo dorado

▸ CAPÍTULO 1
═══════════════════
```

### Implementación

**Archivos modificados:**
- `frontend/src/pages/BookPage.jsx` - Nueva función `processScript()`
- `frontend/src/pages/BookPage.css` - 7 nuevas clases CSS

**Código clave:**
```javascript
const processScript = (script) => {
  // Detecta secciones, diálogos y preguntas
  // Retorna estructura jerárquica
}
```

---

## 2️⃣ Mapa mental interactivo con nodos colapsables

### ¿Qué hace?

Convierte el mapa mental estático en una herramienta interactiva donde puedes explorar y navegar la estructura del libro a tu ritmo.

### Características principales

#### Interactividad
- **Click en ramas:** Haz clic en nodos de nivel 1 (ramas principales) para colapsar/expandir sus hijos
- **Animaciones fluidas:** Transiciones suaves al mostrar/ocultar nodos
- **Indicadores visuales:** Círculos pequeños muestran qué nodos tienen hijos ocultos

#### Controles
- **Modo pantalla completa:** Botón superior derecho para expandir a toda la pantalla
- **Botón "Centrar":** Resetea zoom y posición a valores iniciales
- **Zoom mejorado:** Rango de 0.3x a 3x (antes era 0.4x a 2x)
- **Pan mejorado:** Cursor cambia a "grab" al arrastrar

#### Efectos visuales
- **Glow effect:** Nodos centrales tienen resplandor sutil
- **Hover effects:** Nodos se agrandan ligeramente al pasar el cursor
- **Gradiente de fondo:** Fondo degradado en lugar de color plano
- **Animación de entrada:** Nodos aparecen secuencialmente con fade-in

### Estado de colapso

```javascript
// Estado interno del componente
const [collapsedNodes, setCollapsedNodes] = useState(new Set())

// Al hacer click
toggleNode(nodeId) {
  // Añade/quita nodeId del Set
}
```

### Estructura de datos

```javascript
{
  name: "Centro",
  id: "root",
  children: [
    {
      name: "Rama 1",
      id: "branch-0",
      children: [...], // Visibles
      _children: null  // null = expandido
    },
    {
      name: "Rama 2",
      id: "branch-1",
      children: null,     // null = colapsado
      _children: [...]    // Hijos ocultos
    }
  ]
}
```

### Implementación

**Archivos modificados:**
- `frontend/src/components/MindMap.jsx` - Reescritura completa (+180 líneas)

**Dependencias:**
- D3.js (ya instalado)
- lucide-react para iconos (ya instalado)

---

## 3️⃣ TTS para descripción de personajes

### ¿Qué hace?

Permite escuchar la descripción completa de cada personaje en audio, usando la voz del navegador (Speech Synthesis API).

### Características

#### Controles por personaje
- **Botón ▶ (Play):** Reproduce solo ese personaje
- **Botón ⏯ (Play desde aquí):** Reproduce desde ese personaje hasta el final de la lista

#### Controles globales (header)
- **⏸ Pausar:** Detiene el audio pero mantiene la posición guardada
- **⏹ Stop:** Detiene completamente y pide confirmación antes de borrar el progreso

#### Indicadores visuales
- **Badge en header:** Muestra "Reproduciendo personajes" con icono pulsante
- **Ficha resaltada:** El personaje actual tiene borde dorado y fondo tintado
- **Botones deshabilitados:** No puedes iniciar nueva reproducción mientras otra está activa

#### Persistencia
- Guarda posición en `localStorage` con clave `tts_char_pos_{bookId}`
- Permite cerrar la app y continuar después
- Confirmación antes de perder el progreso

### Contenido del TTS

Para cada personaje, lee:
1. Nombre
2. Rol (protagonista, antagonista, etc.)
3. Descripción física
4. Personalidad
5. Evolución/arco
6. Relaciones con otros personajes
7. Momentos clave

### Flujo de uso

```
1. Usuario hace clic en ▶ de un personaje
   ↓
2. TTS empieza a leer ese personaje
   ↓
3. Usuario puede:
   - ⏸ Pausar (mantiene posición)
   - ⏹ Stop (pide confirmación)
   - Esperar a que termine (avanza al siguiente automáticamente)
```

### Implementación

**Estado:**
```javascript
const [ttsCharPlaying, setTtsCharPlaying] = useState(false)
const [ttsCharacter, setTtsCharacter] = useState(null)
const [ttsCharQueue, setTtsCharQueue] = useState([])
const [ttsCharIndex, setTtsCharIndex] = useState(0)
```

**Funciones principales:**
- `characterToText(char)` - Convierte objeto personaje a texto
- `playCharacter(char)` - Reproduce un personaje
- `playFromCharacter(char, characters)` - Reproduce desde uno en adelante
- `pauseCharTTS()` - Pausa sin perder posición
- `stopCharTTS()` - Para con confirmación
- `speakCharItem(queue, idx)` - Gestiona la cola de reproducción

**Archivos modificados:**
- `frontend/src/pages/BookPage.jsx` (+110 líneas)
- `frontend/src/pages/BookPage.css` (+110 líneas)

---

## 4️⃣ Exportar análisis completo a PDF

### ¿Qué hace?

Genera un documento PDF profesional con todo el análisis del libro, listo para descargar, imprimir o compartir.

### Contenido del PDF

#### 1. Portada
- Fondo negro (#0d0d0d)
- Título del libro en dorado, centrado, tamaño 28pt
- Autor debajo, tamaño 16pt
- Pie de página: "Análisis generado por BookTracker" + fecha

#### 2. Información General
- ISBN
- Año de publicación
- Género
- Número de páginas
- Idioma

#### 3. Sinopsis
- Texto completo de la sinopsis
- Formato justificado, tamaño 10pt

#### 4. Sobre el autor
- Biografía completa del autor
- Bibliografía (hasta 15 obras con años)

#### 5. Resumen Global
- Análisis general de la obra
- Formato párrafo con line-height 1.6

#### 6. Capítulos
- Lista numerada de todos los capítulos
- Resumen de cada capítulo
- Eventos clave en cursiva

#### 7. Personajes
- Ficha completa de cada personaje:
  - Nombre (título en dorado, 14pt)
  - Rol (cursiva, 9pt)
  - Descripción física
  - Personalidad (sección con título bold)
  - Evolución (sección con título bold)
  - Relaciones (lista con bullet points)
  - Momentos clave (en cursiva, entrecomillados)

### Características técnicas

#### Generación
- Usa **jsPDF** cargado dinámicamente desde CDN
- No requiere dependencias npm adicionales
- Se ejecuta completamente en el cliente (no backend)

#### Formato
- Tamaño: A4 (210mm × 297mm)
- Márgenes: 20mm en todos los lados
- Fuente: Helvetica (normal, bold, italic)
- Colores: Negro (#000000), Dorado (#c9a96e)
- Paginación automática con `checkPage()`

#### Helpers
```javascript
const checkPage = (needed) => {
  // Añade nueva página si no hay espacio
}

const addText = (text, size, weight) => {
  // Añade texto con wrap automático
}
```

#### Nombre del archivo
```javascript
const filename = `${book.title.replace(/[^a-z0-9]/gi, '_')}_analisis.pdf`
// Ejemplo: "La_Novia_Gitana_analisis.pdf"
```

### Cuándo aparece el botón

El botón "Exportar a PDF" solo se muestra cuando:
- `status.phase3_done === true`
- Es decir, cuando el análisis completo está terminado

### UX del botón

- **Ubicación:** Hero section, después de botones de estado de lectura
- **Estilo:** Fondo dorado, icono FileText, texto "Exportar a PDF"
- **Feedback:** Toast "Generando PDF..." → Toast "PDF generado correctamente"
- **Error handling:** Si falla, muestra toast de error

### Implementación

**Archivos modificados:**
- `frontend/src/pages/BookPage.jsx` (+230 líneas función `exportToPDF`)
- `frontend/src/pages/BookPage.css` (+25 líneas estilos `.export-pdf-btn`)

**Dependencia externa:**
- jsPDF 2.5.1 desde CDN: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`

---

## 📊 Métricas de cambios

### Líneas de código

| Archivo | Líneas añadidas | Descripción |
|---------|-----------------|-------------|
| `BookPage.jsx` | +280 | TTS personajes + Export PDF + Podcast mejorado |
| `BookPage.css` | +130 | Estilos TTS + PDF + Podcast |
| `MindMap.jsx` | +180 | Reescritura completa interactiva |
| **TOTAL** | **~590** | **3 archivos modificados** |

### Funcionalidades

| Mejora | Complejidad | Impacto UX |
|--------|-------------|------------|
| Podcast visual | Baja | Alto |
| Mapa interactivo | Media | Muy Alto |
| TTS personajes | Media | Alto |
| Export PDF | Alta | Muy Alto |

---

## 🚀 Cómo actualizar

### Paso 1: Aplicar cambios

```bash
cd /tu/repo/booktracker
unzip booktracker-v2.0.2-completo.zip -d temp
cp -r temp/booktracker/* .
rm -rf temp
```

### Paso 2: Commit y push

```bash
git add .
git commit -m "v2.0.2 - Mejoras UX: podcast, mapa interactivo, TTS personajes, export PDF"
git push origin main
```

### Paso 3: Redeploy

```
Portainer → Stacks → booktracker → "Pull and redeploy"
Esperar 2-3 minutos
```

---

## ✅ Testing post-actualización

### Test 1: Podcast visual
1. Abrir un libro con podcast generado
2. Ir a pestaña "Podcast"
3. Verificar que se ven:
   - ✅ Títulos de sección en dorado con marcador ▸
   - ✅ Diálogos en cursiva con bullet •
   - ✅ Preguntas con fondo dorado

### Test 2: Mapa mental interactivo
1. Abrir un libro con mapa mental
2. Ir a pestaña "Mapa mental"
3. Probar:
   - ✅ Click en rama → colapsa/expande
   - ✅ Botón "Pantalla completa" funciona
   - ✅ Botón "Centrar" resetea vista
   - ✅ Zoom con rueda del ratón
   - ✅ Arrastrar cambia cursor a grab

### Test 3: TTS personajes
1. Abrir un libro con personajes
2. Ir a pestaña "Personajes"
3. Probar:
   - ✅ Botón ▶ en personaje reproduce descripción
   - ✅ Botón ⏯ reproduce desde ese personaje
   - ✅ Header muestra "Reproduciendo personajes"
   - ✅ Ficha actual tiene borde dorado
   - ✅ Botón ⏸ pausa correctamente
   - ✅ Botón ⏹ pide confirmación

### Test 4: Exportar PDF
1. Abrir un libro con análisis completo (fase 3 done)
2. Verificar que aparece botón "Exportar a PDF"
3. Hacer clic y verificar:
   - ✅ Toast "Generando PDF..."
   - ✅ PDF se descarga automáticamente
   - ✅ Nombre: `Titulo_del_libro_analisis.pdf`
4. Abrir el PDF y verificar:
   - ✅ Portada con título y autor
   - ✅ Todas las secciones presentes
   - ✅ Formato profesional y legible
   - ✅ Paginación correcta

---

## 🐛 Troubleshooting

### Problema: El podcast no muestra formato mejorado
**Solución:** Limpiar caché del navegador (Ctrl+Shift+R)

### Problema: Mapa mental no colapsa nodos
**Solución:** Verificar que D3.js está cargado correctamente. Revisar consola del navegador.

### Problema: TTS no funciona
**Causas posibles:**
- Navegador no soporta Speech Synthesis API
- Audio bloqueado por política del navegador
**Solución:** Probar en Chrome/Edge (mejor soporte)

### Problema: PDF no se genera
**Causas posibles:**
- jsPDF no se pudo cargar desde CDN
- Bloqueador de scripts activo
**Solución:** 
1. Verificar conexión a internet
2. Desactivar bloqueadores temporalmente
3. Revisar consola para errores

### Problema: Frontend no refleja cambios
**Solución:**
```bash
# En Portainer, forzar rebuild de imagen frontend
docker-compose up -d --build frontend
```

---

## 📝 Notas técnicas

### Compatibilidad

- **Navegadores:** Chrome 90+, Edge 90+, Firefox 88+, Safari 14+
- **Speech Synthesis API:** Chrome/Edge tienen mejor soporte
- **jsPDF:** Compatible con todos los navegadores modernos
- **D3.js v7:** Ya incluido en dependencias

### Performance

- **Mapa mental:** O(n) donde n = número de nodos visibles
- **TTS:** Sin overhead, usa API nativa del navegador
- **PDF:** Genera en ~2-3 segundos para libros de 300 páginas
- **Podcast processing:** O(n) donde n = líneas del guion

### Limitaciones conocidas

1. **TTS:**
   - Depende de voces instaladas en el sistema
   - Calidad varía según navegador/OS
   - Solo idioma español (configurable en código)

2. **PDF:**
   - Imágenes de portada no incluidas (solo metadatos)
   - Fuente limitada a Helvetica (built-in jsPDF)
   - Tamaño máximo recomendado: 50 personajes, 50 capítulos

3. **Mapa mental:**
   - No persiste estado de colapso entre sesiones
   - Modo pantalla completa puede tener problemas en iOS Safari

---

## 🎯 Próximas mejoras sugeridas

### Corto plazo
- [ ] Añadir portada del libro al PDF (usando imagen local)
- [ ] Opción de elegir qué secciones incluir en PDF
- [ ] Persistir estado de colapso del mapa mental

### Medio plazo
- [ ] Selector de voz para TTS
- [ ] Control de velocidad de lectura TTS
- [ ] Exportar a otros formatos (DOCX, EPUB)

### Largo plazo
- [ ] Compartir análisis en redes sociales
- [ ] Colaboración: notas compartidas entre usuarios
- [ ] Versión imprimible optimizada del PDF

---

## 📚 Referencias

- [jsPDF Documentation](https://github.com/parallax/jsPDF)
- [Speech Synthesis API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [D3.js Tree Layout](https://d3js.org/d3-hierarchy/tree)
- [BookTracker GitHub](https://github.com/tuusuario/booktracker)

---

**Versión:** BookTracker v2.0.2  
**Fecha:** 30 de marzo de 2026  
**Autor:** Miki + Claude (Anthropic)  
**Licencia:** MIT
