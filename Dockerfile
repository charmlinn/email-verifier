FROM golang:1.22-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/email-verifier-api ./cmd/apiserver

FROM alpine:3.20

RUN adduser -D -H -u 10001 appuser

WORKDIR /app
COPY --from=build /out/email-verifier-api /app/email-verifier-api

ENV PORT=9090
EXPOSE 9090

USER appuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9090/healthz >/dev/null || exit 1

ENTRYPOINT ["/app/email-verifier-api"]
