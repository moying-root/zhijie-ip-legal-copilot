FROM node:22.16.0-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0
COPY --chown=node:node server.cjs package.json ./
COPY --chown=node:node server/ ./server/
COPY --chown=node:node dist/ ./dist/
COPY --chown=node:node scripts/ ./scripts/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4173
CMD ["node", "server.cjs"]
