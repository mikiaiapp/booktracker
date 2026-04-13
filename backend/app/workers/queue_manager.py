"""
BookTracker — Queue Manager
===========================
Garantiza que la IA trabaja en un solo libro a la vez por usuario.
Permite encolar múltiples libros, pausar, reanudar y cancelar.

Estructura en Redis:
  btq:{uid}:queue          → List  [{"book_id","phases","title","ts"}, …]
  btq:{uid}:active         → String  book_id en proceso (vacío = libre)
  btq:{uid}:paused         → String  "1" si pausada
  btq:{uid}:info:{book_id} → Hash   {title, phase, pct, msg, ts}
"""

import json
import time


# ── cliente Redis (síncrono, usado desde workers Celery) ──────────────────────

def _r():
    import redis as _redis
    from app.core.config import settings
    return _redis.from_url(settings.REDIS_URL, decode_responses=True)


def _qk(uid):  return f"btq:{uid}:queue"
def _ak(uid):  return f"btq:{uid}:active"
def _pk(uid):  return f"btq:{uid}:paused"
def _ik(uid, bid): return f"btq:{uid}:info:{bid}"


# ── API pública ───────────────────────────────────────────────────────────────

def enqueue(uid: str, book_id: str, title: str = "", phases: list = None, force: bool = False) -> int:
    """
    Añade libro a la cola si no está ya (ni en cola ni activo).
    Dispara _pump si no hay activo y no está pausada.
    Devuelve posición en cola (0 = siguiente).
    """
    if phases is None:
        phases = ["1", "2", "3", "4", "podcast"]

    r = _r()
    qk = _qk(uid)

    # ¿Ya activo?
    if r.get(_ak(uid)) == book_id and not force:
        return -1  # ya procesándose
    
    if force:
        r.delete(_ak(uid)) # Liberar slot para permitir re-entrada

    # ¿Ya en cola?
    raw = r.lrange(qk, 0, -1)
    for i, x in enumerate(raw):
        try:
            e = json.loads(x)
            if e.get("book_id") == book_id:
                return i
        except Exception:
            pass

    entry = json.dumps({"book_id": book_id, "phases": phases, "force": force,
                        "title": title, "ts": time.time()})
    r.rpush(qk, entry)
    pos = r.llen(qk) - 1

    _set_info(uid, book_id, "queued", 0, f"En cola — posición {pos + 1}", title, model="")
    _pump(uid)
    return pos


def get_state(uid: str) -> dict:
    """Estado completo de la cola: activo, cola, pausado, info por libro."""
    r = _r()
    active = r.get(_ak(uid))
    paused = bool(r.get(_pk(uid)))
    raw = r.lrange(_qk(uid), 0, -1)
    queue = []
    for x in raw:
        try:
            queue.append(json.loads(x))
        except Exception:
            pass

    infos = {}
    keys = r.keys(f"btq:{uid}:info:*")
    for k in keys:
        bid = k.split(":")[-1]
        d = r.hgetall(k)
        if d:
            infos[bid] = d

    return {"paused": paused, "active": active, "queue": queue, "infos": infos}


def pause(uid: str):
    """Pausa la cola. El libro activo termina su fase actual, el siguiente no arranca."""
    _r().set(_pk(uid), "1")


def resume(uid: str):
    """Reanuda la cola y arranca el siguiente si no hay activo."""
    r = _r()
    r.delete(_pk(uid))
    _pump(uid)


def cancel(uid: str, book_id: str) -> str:
    """
    Elimina el libro de la cola o marca como cancelado si está activo.
    Retorna: 'removed' | 'cancelled' | 'not_found'
    """
    r = _r()
    qk = _qk(uid)

    # En cola → eliminar directamente
    raw = r.lrange(qk, 0, -1)
    for x in raw:
        try:
            e = json.loads(x)
            if e.get("book_id") == book_id:
                r.lrem(qk, 1, x)
                r.delete(_ik(uid, book_id))
                return "removed"
        except Exception:
            pass

    # Activo → marcar flag de aborto para el worker
    if r.get(_ak(uid)) == book_id:
        task_id = r.hget(_ik(uid, book_id), "task_id")
        if not task_id:
            r.delete(_ak(uid))
            r.delete(_ik(uid, book_id))
            _pump(uid)
            return "cancelled"
            
        try:
            _r().setex(f"btq:{uid}:cancel_flag:{book_id}", 3600, "1")
            return task_id
        except Exception:
            return "cancelled"

    return "not_found"


def cancel_all(uid: str):
    """Vacía la cola completa, cancela el libro activo y limpia TODO el rastro en Redis."""
    r = _r()
    # 1. Obtener task_id del activo antes de borrar todo
    active = r.get(_ak(uid))
    tid = None
    if active:
        tid = r.hget(_ik(uid, active), "task_id")

    # 2. Borrado masivo de todas las llaves asociadas al usuario
    keys = r.keys(f"btq:{uid}:*")
    if keys:
        print(f"[QUEUE] Borrando {len(keys)} llaves de Redis para usuario {uid}")
        r.delete(*keys)
    
    # 3. Asegurar limpieza de slots específicos (redundante pero seguro)
    r.delete(_qk(uid), _ak(uid), _pk(uid))
    
    return tid


def on_done(uid: str, book_id: str):
    """Llamar cuando un libro termina (éxito o error). Libera el slot y arranca el siguiente."""
    r = _r()
    if r.get(_ak(uid)) == book_id:
        r.delete(_ak(uid))
    r.delete(_ik(uid, book_id))
    _pump(uid)


def update_progress(uid: str, book_id: str, phase: str, pct: int, msg: str, model: str = ""):
    """Actualiza el progreso visible del libro activo."""
    r = _r()
    # Asegurar que el libro se registra como activo (útil para disparos manuales)
    r.set(_ak(uid), book_id, ex=7200)
    key = _ik(uid, book_id)
    # Conservar título y modelo si existen y no se proveen nuevos
    title = r.hget(key, "title") or ""
    if not model:
        model = r.hget(key, "model") or ""
    _set_info(uid, book_id, phase, pct, msg, title, model=model)


# ── Internos ──────────────────────────────────────────────────────────────────

def _pump(uid: str):
    """Arranca el siguiente libro de la cola si no hay activo y no está pausada."""
    r = _r()
    if r.get(_pk(uid)):
        return  # pausada
    if r.get(_ak(uid)):
        return  # ya hay activo

    raw = r.lpop(_qk(uid))
    if not raw:
        return  # cola vacía

    try:
        entry = json.loads(raw)
    except Exception:
        return

    book_id = entry["book_id"]
    phases  = entry.get("phases", ["1", "2", "3", "4", "podcast"])
    title   = entry.get("title", "")
    force   = entry.get("force", False)

    from app.core.config import settings
    # TTL de seguridad: si el worker muere, el slot se libera en 2 horas
    r.set(_ak(uid), book_id, ex=7200)
    _set_info(uid, book_id, "starting", 5, "Iniciando…", title, model=settings.AI_MODEL)

    _launch(uid, book_id, phases, title=title, force=force)


def _launch(uid: str, book_id: str, phases: list, title: str = "", force: bool = False):
    """Lanza la primera fase solicitada. La cadena interna en tasks.py hace el resto."""
    from app.workers.tasks import (
        process_book_phase1, process_book_phase2,
        process_book_phase3, process_book_phase4,
        process_book_phase5, process_book_phase6
    )
    first = phases[0] if phases else "1"
    dispatch = {
        "1": lambda: process_book_phase1.delay(uid, book_id, chain=True, force=force),
        "2": lambda: process_book_phase2.delay(uid, book_id, chain=True, force=force),
        "3": lambda: process_book_phase3.delay(uid, book_id, chain=True, force=force),
        "4": lambda: process_book_phase4.delay(uid, book_id, chain=True, force=force),
        "5": lambda: process_book_phase5.delay(uid, book_id, chain=True, force=force),
        "6": lambda: process_book_phase6.delay(uid, book_id, force=force),
        "podcast": lambda: process_book_phase6.delay(uid, book_id, force=force),
        "repair":  lambda: process_book_phase2.delay(uid, book_id, chain=True, force=force), # repair as chain start
    }
    fn = dispatch.get(str(first))
    if fn:
        res = fn()
        if hasattr(res, "id"):
            from app.core.config import settings
            _set_info(uid, book_id, f"phase{first}", 5, f"Estación {first} iniciada…", title, task_id=res.id, model=settings.AI_MODEL)


def _set_info(uid, book_id, phase, pct, msg, title="", task_id=None, model=""):
    r = _r()
    mapping = {
        "phase": phase, "pct": str(pct),
        "msg": msg, "title": title, "ts": str(time.time()),
        "model": model
    }
    if task_id:
        mapping["task_id"] = task_id
    
    r.hset(_ik(uid, book_id), mapping=mapping)
    r.expire(_ik(uid, book_id), 86400)
