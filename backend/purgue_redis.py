import redis
import os

def purgue_redis():
    # Obtener URL de Redis desde el entorno o usar el default de NAS
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    try:
        r = redis.from_url(redis_url)
        print(f"[*] Conectando a Redis en: {redis_url}")
        
        # Buscar todas las llaves de la cola
        keys = r.keys("btq:*")
        if not keys:
            print("[!] No se han encontrado llaves bloqueadas de BookTracker.")
            return

        print(f"[*] Encontradas {len(keys)} llaves. Purgando...")
        for key in keys:
            r.delete(key)
        
        # Limpiar también la tarea activa global si existe
        r.delete("btq:active_task")
        
        print("[✓] ÉXITO: Redis ha sido limpiado. La cola debería estar desbloqueada.")
    except Exception as e:
        print(f"[!] ERROR al limpiar Redis: {e}")

if __name__ == "__main__":
    purgue_redis()
