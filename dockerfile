# build container
FROM node:22-alpine AS build-env
# copy only necessary files (.dockerignore)
COPY . /app
WORKDIR /app

RUN npm ci --omit=dev

# runtime container
FROM gcr.io/distroless/nodejs22-debian12
COPY --from=build-env /app /app
WORKDIR /app
CMD [ "node", "index.js" ]