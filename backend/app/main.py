from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from app.core.config import settings
from app.core.database import init_global_db
from app.api import auth, books, analysis, users, chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_global_db()
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    os.makedirs(settings.AUDIO_DIR, exist_ok=True)
    os.makedirs(settings.COVERS_DIR, exist_ok=True)
    os.makedirs(settings.DATABASE_DIR, exist_ok=True)
    
    # --- Monitor de Latidos (Caja Negra) ---
    import threading, time, datetime
    def heartbeat():
        log_path = os.path.join("/data", "heartbeat.log")
        while True:
            try:
                with open(log_path, "a") as f:
                    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    f.write(f"[{now}] API viva. PID: {os.getpid()}\n")
            except: pass
            time.sleep(30)
    
    monitor_thread = threading.Thread(target=heartbeat, daemon=True)
    monitor_thread.start()
    print("[INIT] Monitor de latidos iniciado en /data/heartbeat.log")
    
    yield


app = FastAPI(
    title="BookTracker API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Healthcheck endpoint ───────────────────────────────────────
@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok"}

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(books.router, prefix="/api/books", tags=["books"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
