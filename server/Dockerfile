# Build from the repo root:
#   docker build -f server/Dockerfile .
# Stage 1 builds /tv if it has a package.json (npm run build -> dist/), or
# uses /tv as plain static files. Stage 2 embeds the result into the server.

FROM node:22-alpine AS tv
WORKDIR /src
COPY . .
RUN mkdir -p /out && if [ -d tv ]; then cd tv && \
      if [ -f package.json ]; then \
        (npm ci || npm install) && npm run build && cp -r dist/. /out/; \
      else \
        cp -r . /out/; \
      fi; \
    fi

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY protocol/ protocol/
COPY server/ server/
# The TV build replaces the placeholder page (if there is a TV build yet).
COPY --from=tv /out/ server/web/static/
WORKDIR /src/server
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /orchestra ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /orchestra /orchestra
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/orchestra"]
