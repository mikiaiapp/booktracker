# 📋 CHANGELOG

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
