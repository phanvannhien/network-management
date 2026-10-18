# Build stage — latest stable Go (go.mod minimum is 1.26 via golang.org/x/crypto)
FROM golang:1.27-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOWORK=off
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/ntb ./cmd/ntb

# Runtime stage — small image, non-root user; busybox wget is used by the healthcheck.
# pg_dump / pg_restore for backups (P2-13): the same major as the db image (postgres:16) — a newer client writes dumps
# a 16 server refuses; bump both together. rclone copies backups to NAS / SFTP / S3 / Drive destinations. The backup
# directory belongs to the ntb user (a named volume inherits it).
FROM alpine:3.22
RUN apk add --no-cache postgresql16-client rclone \
 && adduser -D -H -u 10001 ntb \
 && mkdir -p /var/lib/ntb/backups && chown ntb /var/lib/ntb/backups && chmod 700 /var/lib/ntb/backups
COPY --from=build /out/ntb /usr/local/bin/ntb
USER ntb
EXPOSE 8069
ENTRYPOINT ["/usr/local/bin/ntb"]
