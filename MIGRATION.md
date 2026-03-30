# 🔄 Migración a BookTracker v2.0 (sin overrides)

Si ya tienes BookTracker desplegado con la versión anterior que usaba `/overrides/`, sigue estos pasos para migrar a la nueva versión simplificada.

## ¿Qué cambia?

- ❌ **Eliminado:** Carpeta `/volume1/docker/booktracker/overrides/`
- ❌ **Eliminado:** Bind mounts individuales de archivos Python
- ✅ **Nuevo:** Todo el código vive en el repositorio Git
- ✅ **Nuevo:** Actualizaciones más simples con "Pull and redeploy"

## Pasos de migración

### 1. Backup de datos (recomendado)

```bash
# SSH al NAS
ssh admin@IP-NAS

# Backup de bases de datos y archivos
cd /volume1/docker/booktracker
tar -czf backup-pre-v2-$(date +%Y%m%d).tar.gz data/
```

### 2. Actualizar el repositorio

```bash
# En tu máquina local
cd /ruta/a/tu/repo/booktracker
git pull origin main  # O el nombre de tu rama principal
```

Verás que el `docker-compose.yml` y `README.md` están actualizados.

### 3. Redeploy en Portainer

1. **Portainer → Stacks → booktracker**
2. Clic en **"Pull and redeploy"**
3. Espera 2-3 minutos mientras reconstruye las imágenes

Portainer detectará que los bind mounts de `/overrides/` ya no existen en el nuevo `docker-compose.yml` y los eliminará automáticamente.

### 4. Verificar que todo funciona

```bash
# Ver logs
docker logs booktracker-backend
docker logs booktracker-worker

# Verificar que los contenedores están corriendo
docker ps | grep booktracker
```

### 5. Limpieza (opcional)

Una vez verificado que todo funciona correctamente:

```bash
# Eliminar carpeta de overrides (ya no se usa)
ssh admin@IP-NAS
rm -rf /volume1/docker/booktracker/overrides
```

## ¿Problemas?

### "Backend no arranca después de la migración"

```bash
# Ver logs detallados
docker logs booktracker-backend --tail 100

# Reiniciar el stack completo
docker-compose -f /volume1/docker/booktracker/docker-compose.yml restart
```

### "Worker no procesa libros"

```bash
# Verificar que Redis está corriendo
docker logs booktracker-redis

# Reiniciar worker
docker restart booktracker-worker
```

### "Quiero volver a la versión anterior"

Si necesitas revertir:

1. En Portainer, edita el Stack
2. Reemplaza el contenido con tu `docker-compose.yml` anterior
3. Recrea los archivos en `/overrides/` si los borraste
4. Redeploy

## Ventajas de la nueva versión

✅ **Despliegue más limpio** - Solo una carpeta de datos  
✅ **Sin SCP manual** - Todo el código en Git  
✅ **Actualizaciones simples** - Un clic en Portainer  
✅ **Mejor control de versiones** - Todo el código versionado  
✅ **Más fácil de colaborar** - Pull requests estándar de Git  

## ¿Preguntas?

Abre un issue en GitHub o consulta el README.md actualizado.
