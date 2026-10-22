FROM oven/bun:1.4.4-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATABASE_PATH=/app/data/en-marge.sqlite

COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun public ./public

RUN mkdir -p /app/data && chown bun:bun /app/data

USER bun
VOLUME ["/app/data"]
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD bun -e 'const r = await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "run", "start"]
