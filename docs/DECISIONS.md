# Quyết định kiến trúc (ADR)

Mỗi quyết định có: bối cảnh, quyết định, lý do, khi nào xem lại. Thêm ADR mới ở cuối file, không sửa ADR cũ;
nếu đổi ý thì viết ADR mới ghi "Thay thế ADR-xxx".

---

### ADR-001 — Web app self-hosted
- **Quyết định:** web SPA, triển khai bằng Docker Compose trên máy/server của người dùng. Không phụ thuộc dịch vụ cloud bên ngoài.
- **Lý do:** sơ đồ mạng là dữ liệu nhạy cảm; về sau cần poll SNMP trong mạng nội bộ.

### ADR-002 — React + TypeScript + shadcn/ui
- **Quyết định:** React 18, TypeScript strict, shadcn/ui + Tailwind. Không dùng Vue 3 / Ant Design.
- **Lý do:** hệ sinh thái diagram mạnh nhất (React Flow); shadcn/ui copy code vào dự án nên kiểm soát hoàn toàn giao diện và Dark Mode.

### ADR-003 — Canvas dùng React Flow
- **Quyết định:** @xyflow/react cho canvas.
- **Lý do:** có sẵn zoom/pan/minimap/handle/edge custom, phát triển nhanh.
- **Xem lại khi:** benchmark P1-13 không đạt với 2.000 thiết bị/trang → cân nhắc Konva hoặc PixiJS.

### ADR-004 — Backend Go (chi, pgx, sqlc)
- **Quyết định:** Go thay vì Node.js. Router chi, truy cập Postgres bằng pgx v5 + sqlc, migration bằng golang-migrate.
- **Lý do:** cần poll SNMP song song nhiều thiết bị (goroutine, gosnmp); 1 binary nhỏ, ít RAM, dễ self-host.
- **Đánh đổi:** không dùng chung code TypeScript với frontend → xử lý bằng ADR-006.

### ADR-005 — PostgreSQL thuần, không Supabase
- **Quyết định:** Postgres 16 chạy trong Compose; auth và API tự viết.
- **Lý do:** Supabase self-host quá nặng cho nhu cầu này; Postgres thuần đơn giản, dễ backup.

### ADR-006 — JSON Schema là hợp đồng chung FE ↔ BE
- **Quyết định:** `schema/ntb.schema.json` là nguồn duy nhất. Frontend sinh TS types + validate bằng ajv; backend validate bằng thư viện JSON Schema cho Go và có Go struct viết tay khớp schema.
- **Lý do:** thay cho việc dùng chung zod khi backend không phải TypeScript.
- **Ràng buộc:** test round-trip Go với mọi file trong `/testdata`.

### ADR-007 — MVP chỉ có frontend
- **Quyết định:** Phase 1 chạy hoàn toàn trong trình duyệt (IndexedDB + file JSON), chưa có backend.
- **Lý do:** đưa giá trị cốt lõi (vẽ, khai báo, kiểm lỗi) tới tay người dùng sớm nhất.

### ADR-008 — SNMP chỉ đọc, đẩy live bằng SSE
- **Quyết định:** chỉ GET/WALK/BULKWALK, không SET. Ưu tiên SNMPv3. Credential mã hóa AES-GCM. Poller chạy trong cùng binary với API. Trạng thái đẩy về trình duyệt bằng Server-Sent Events.
- **Lý do:** an toàn cho mạng thật; SSE đủ cho luồng một chiều server → client, đơn giản hơn WebSocket.
- **Lưu ý triển khai:** container backend phải đi tới được mạng quản trị thiết bị (route từ host Docker, hoặc `network_mode: host` nếu cần).

### ADR-009 — Hoãn cộng tác realtime
- **Quyết định:** chưa làm ở Phase 1–3. Trước mắt dùng optimistic lock khi lưu (P2-04).
- **Khi làm:** cân nhắc Yjs với một sidecar Node chạy y-websocket bên cạnh API Go.
