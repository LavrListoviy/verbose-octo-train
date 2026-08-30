FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM build AS test
COPY babel.config.cjs jest.config.cjs jest.integration.config.cjs tsconfig.test.json ./
COPY drizzle ./drizzle
COPY tests ./tests
CMD ["npm", "run", "test:integration:container"]

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
USER node
CMD ["npm", "run", "start:docker"]
