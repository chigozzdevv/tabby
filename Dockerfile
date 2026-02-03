FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-alpine AS build
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
