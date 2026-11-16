FROM node:24-bookworm-slim
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY backend /app/backend
ENV HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/mailboxes.sqlite
USER node
EXPOSE 8787
CMD ["node", "backend/index.mjs"]
