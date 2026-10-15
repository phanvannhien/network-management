# Nhật ký trạng thái

Mục mới nhất ở trên cùng. Claude Code ghi vào đây sau mỗi task (mẫu trong `CLAUDE.md`).
Khi cần bàn bạc trên claude.ai, dán mục mới nhất (hoặc cả file) vào chat.

---

## 2026-10-15 — P0-01 Khung monorepo
- Đã làm:
  - `/frontend`: scaffold Vite + React + TS strict (`"strict": true` thêm tay vào tsconfig.app.json), Tailwind CSS v4 (plugin `@tailwindcss/vite`), shadcn/ui init (preset `nova`, Base UI), alias `@/ -> src/`. Trang trống tối giản, title "Network Topology Builder".
  - `/backend`: Go module `github.com/phanvannhien/networkdiagramdrawer/backend`, `cmd/ntb/main.go` in "ok".
  - `Makefile` (dev-web, dev-api hoạt động; sqlc/migrate-up/types/check ghi khung TODO cho task sau), `.editorconfig`, `.gitignore`, `README.md`, thư mục `schema/`, `testdata/`, `deploy/` giữ chỗ.
- Test / cách kiểm tra:
  - `make dev-web` → curl http://localhost:5173/ trả HTTP 200, trang chứa "Network Topology Builder". ✅
  - `cd backend && go build ./...` + `go vet ./...` pass; `go run ./cmd/ntb` in "ok". ✅
  - `npm run build` (gồm `tsc -b` strict) pass. ✅
- Còn dở / lỗi đã biết: template Vite hiện tại dùng TS 6.0 — đã bỏ `baseUrl` (deprecated) và dùng `paths` tương đối.
- Câu hỏi cho người dùng: **React 18 hay 19?** Vite template mới cài sẵn React 19.2.8. CLAUDE.md/ADR ghi React 18. Đề xuất giữ React 19 (stable, `@xyflow/react` v12 hỗ trợ) và cập nhật lại stack trong docs; hoặc hạ xuống 18.3.1 nếu muốn bám đúng ADR.
- Đề xuất quyết định cần chốt: nếu giữ React 19 → thêm ADR-010 (hoặc sửa ADR cũ về stack) ghi rõ thay đổi.
- Task tiếp theo đề xuất: P0-02 Lint & test (ESLint + Prettier + Vitest, golangci-lint, `make check`).

## 2026-10-15 — Khởi tạo tài liệu
- Đã làm: chốt SRS v1.2, kế hoạch theo phase, các ADR 001–009.
- Câu hỏi cho người dùng: quy mô sơ đồ lớn nhất thực tế (thiết bị/trang)? Danh sách hãng/model ưu tiên? Team bao nhiêu người, deadline MVP?
- Task tiếp theo đề xuất: P0-01 Khung monorepo.
