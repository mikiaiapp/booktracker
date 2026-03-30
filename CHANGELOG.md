# 📋 CHANGELOG

## [2.0.2] - 2026-03-30

### ✨ Nuevas funcionalidades

#### 1. Guion del podcast visualmente mejorado
- **Detección automática de secciones:** Reconoce títulos como INTRODUCCIÓN, CAPÍTULO, PARTE, etc.
- **Formateo de diálogos:** Líneas con `-` o `•` se muestran en cursiva con marcador visual
- **Preguntas destacadas:** Líneas que terminan en `?` aparecen con fondo dorado y borde
- **Separación clara:** Cada sección tiene un título dorado con borde inferior
- **Resultado:** Guion más legible y atractivo, similar a un guion profesional

#### 2. Mapa mental interactivo con nodos colapsables
- **Click para expandir/colapsar:** Haz clic en ramas principales para mostrar/ocultar sus hijos
- **Animaciones suaves:** Transiciones fluidas al expandir/colapsar nodos
- **Modo pantalla completa:** Botón para ver el mapa en pantalla completa
- **Efectos visuales:** Glow en nodos principales, hover effects, gradiente de fondo
- **Botón "Centrar":** Resetea la vista a la posición inicial
- **Zoom mejorado:** Rango de 0.3x a 3x con cursor grab/grabbing
- **Indicadores:** Círculos pequeños muestran qué nodos tienen hijos colapsados

#### 3. TTS para descripción de personajes
- **Reproducción por personaje:** Botón ▶ en cada ficha para escuchar su descripción
- **Reproducir desde aquí:** Botón ⏯ para escuchar desde un personaje en adelante
- **Controles en header:** Botones de pausa ⏸ y stop ⏹ siempre visibles
- **Indicador visual:** La ficha del personaje siendo reproducido se resalta con borde dorado
- **Confirmación al detener:** Al hacer stop, pide confirmación para no perder el progreso
- **Persistencia:** Guarda posición en localStorage para continuar después
- **Contenido TTS:** Lee nombre, rol, descripción, personalidad, evolución, relaciones y momentos clave

#### 4. Exportar análisis completo a PDF
- **Botón en hero section:** Aparece cuando el análisis está completo (fase 3 terminada)
- **Contenido completo del PDF:**
  - Portada con título, autor y fecha de generación
  - Información general (ISBN, año, género, páginas, idioma)
  - Sinopsis completa
  - Biografía del autor
  - Bibliografía del autor (hasta 15 obras)
  - Resumen global del libro
  - Capítulos con resúmenes y eventos clave
  - Fichas completas de personajes con todas sus secciones
- **Formato profesional:** Diseño con colores dorados, tipografía clara, paginación automática
- **Descarga automática:** Genera y descarga el PDF con nombre `Titulo_del_libro_analisis.pdf`

### 🎨 Mejoras de UX

- **Guion podcast:** Mejor legibilidad con secciones, diálogos y preguntas diferenciadas
- **Mapa mental:** Más interactivo y explorable, menos abrumador con muchos nodos
- **TTS personajes:** Acceso rápido a descripción en audio sin navegar a otras pestañas
- **Export PDF:** Posibilidad de compartir o imprimir el análisis completo fácilmente

### 🔧 Cambios técnicos

- **BookPage.jsx:** +280 líneas (funciones TTS personajes + exportar PDF)
- **BookPage.css:** +130 líneas (estilos para TTS y PDF)
- **CharactersTab:** Completamente refactorizado con props TTS
- **MindMap.jsx:** Reescrito con estado colapsable y efectos visuales
- **PodcastTab:** Nueva lógica de procesamiento de script con detección de patrones
- **jsPDF:** Se carga dinámicamente desde CDN solo cuando se exporta

### 📦 Archivos modificados

```
frontend/src/pages/BookPage.jsx        (+280 líneas)
frontend/src/pages/BookPage.css        (+130 líneas)
frontend/src/components/MindMap.jsx    (+180 líneas)
```

**Total:** 3 archivos, ~590 líneas añadidas/modificadas

---

## [2.0.1] - 2026-03-30

### 🐛 Bugfixes

#### Portadas faltantes en Bibliografía de Autores
- **Problema:** En la página de Autores, los libros de la bibliografía no añadidos aparecían sin portada (placeholder), mientras que en "Otras obras del autor" sí tenían portada
- **Causa:** Al crear fichas shell desde la bibliografía, se ignoraban los metadatos `year`, `cover_url` y `synopsis` que ya venían de Google Books
- **Solución:** 
  - Ampliado `CreateShellRequest` para aceptar metadatos adicionales
  - Frontend pasa `year`, `cover_url` y `synopsis` al crear shells
  - Visualización de bibliografía muestra portadas antes de añadir el libro
- **Archivos modificados:** `books.py`, `api.js`, `AuthorsPage.jsx`
- **Resultado:** Consistencia total entre vista de Autores y vista de libro individual

### ✨ Mejoras menores
- Año de publicación visible en libros no añadidos de la bibliografía
- Sinopsis disponible desde la creación de la ficha shell
- Mejor UX: usuario ve portadas antes de añadir libros

---

## [2.0.0] - 2026-03-30

### 🎉 Simplificación mayor - Eliminación de overrides

**Breaking Changes:**
- Eliminada la carpeta `/overrides/` del sistema de despliegue
- Todos los archivos Python ahora se incluyen directamente en la imagen Docker
- Actualizaciones requieren "Pull and redeploy" en Portainer (2-3 min)

### ✨ Mejoras

#### Despliegue simplificado
- ✅ Solo se necesita crear `/volume1/docker/booktracker/data/`
- ✅ Sin necesidad de SCP manual de archivos
- ✅ Todo el código vive en el repositorio Git
- ✅ Proceso de setup reducido a un solo comando SSH

#### Docker & Portainer
- Eliminados 7 bind mounts individuales de archivos Python
- Optimizado `.dockerignore` para builds más rápidas
- Simplificado `docker-compose.yml` (48 líneas menos)
- Actualizaciones centralizadas: git push → Pull and redeploy

#### Documentación
- README.md completamente reescrito y simplificado
- Nueva guía de migración (MIGRATION.md) para usuarios existentes
- Eliminadas referencias obsoletas a overrides
- Comandos útiles actualizados

#### Scripts
- `setup.sh` simplificado (de 41 a 28 líneas)
- Eliminada lógica de copia de overrides
- Mejor manejo de errores

### 📦 Archivos modificados

```
docker-compose.yml      - Eliminados bind mounts de overrides
README.md               - Reescrito con nuevo flujo de trabajo
setup.sh                - Simplificado
.dockerignore           - Nuevo archivo para optimizar builds
MIGRATION.md            - Nueva guía de migración
```

### 📊 Estadísticas

- **Líneas eliminadas:** ~150 líneas de configuración y documentación
- **Pasos de despliegue:** De 4 pasos a 2 pasos
- **Archivos a gestionar manualmente:** De 7 a 0
- **Tiempo de setup inicial:** De ~10 min a ~3 min

### 🔄 Migración desde v1.x

Ver [MIGRATION.md](MIGRATION.md) para instrucciones detalladas.

**Resumen rápido:**
1. Backup de datos
2. Pull del repo actualizado
3. "Pull and redeploy" en Portainer
4. Opcional: borrar `/overrides/` del NAS

### ⚙️ Compatibilidad

- ✅ Bases de datos existentes (sin cambios en esquema)
- ✅ Archivos subidos (uploads, covers, audio)
- ✅ Variables de entorno (sin cambios)
- ✅ Configuración de Redis y Celery
- ✅ Todas las funcionalidades existentes

### 🐛 Fixes

- Corregida tabla de errores frecuentes en README
- Mejorados comandos de diagnóstico
- Actualizada arquitectura del sistema en documentación

---

## [1.x] - Versiones anteriores

Sistema funcional con arquitectura de overrides para hot-reload de código Python.
