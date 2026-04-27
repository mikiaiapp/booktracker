FROM node:20-alpine AS builder
WORKDIR /app

# Aumentar memoria disponible para el build de Vite
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Instalar dependencias
# npm install en vez de npm ci (no requiere package-lock.json)
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copiar código fuente y compilar
COPY . .
ARG CACHE_BUST=unknown
RUN echo "Building version: $CACHE_BUST"
RUN npm run build

# ── Imagen final (solo el build estático) ─────────────────────
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
