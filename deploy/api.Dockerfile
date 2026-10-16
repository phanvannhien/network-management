# Build stage — latest stable Go (go.mod minimum is 1.26 via golang.org/x/crypto)
FROM golang:1.27-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOWORK=off
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/ntb ./cmd/ntb

# Runtime stage — small image, non-root user; busybox wget is used by the healthcheck.
FROM alpine:3.22
RUN adduser -D -H -u 10001 ntb
COPY --from=build /out/ntb /usr/local/bin/ntb
USER ntb
EXPOSE 8069
ENTRYPOINT ["/usr/local/bin/ntb"]
