FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY service/package.json service/bun.lock ./
RUN bun install --frozen-lockfile
COPY service/ ./
RUN bun run build

FROM oven/bun:1.3-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production \
    HOME=/tmp
COPY --from=build /app/node_modules ./node_modules
COPY service/package.json ./
COPY service/src ./src
COPY --from=build /app/dist ./dist
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown -R app:app /app /data
USER app
EXPOSE 47821
CMD ["bun", "run", "src/server/index.ts"]
