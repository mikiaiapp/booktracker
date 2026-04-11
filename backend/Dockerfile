FROM python:3.12-slim

WORKDIR /app

# Dependencias del sistema para procesado de PDF/EPUB
# - libmagic1:     detección de tipo de archivo
# - poppler-utils: procesado de PDFs (pdftotext, pdfinfo)
# - curl:          healthcheck
# NOTA: calibre eliminado (500MB) — usamos ebooklib para EPUB directamente
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 -r requirements.txt

# Copiar código fuente (ARG invalida cache cuando cambia)
ARG CACHE_BUST=1
COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
