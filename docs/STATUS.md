# Nhật ký trạng thái

Mục mới nhất ở trên cùng. Claude Code ghi vào đây sau mỗi task (mẫu trong `CLAUDE.md`).
Khi cần bàn bạc trên claude.ai, dán mục mới nhất (hoặc cả file) vào chat.

---

## 2026-10-17 — P1-23 Tìm kiếm toàn cục
- Đã làm:
  - **API** `GET /orgs/{orgId}/search?q=` (2–100 ký tự, tối đa 10 kết quả mỗi nhóm), trả về:
    - thiết bị: theo hostname / S/N / part number / model / mã tài sản, kèm trường nào khớp;
    - cụm (stack, HA): theo tên hoặc hostname;
    - địa chỉ IP: gõ đúng một IP (cả IPv6, viết kiểu nào cũng được) thì ra đúng IP đó; gõ subnet `10.136.10.0/24` thì ra mọi IP trong subnet;
      gõ dở `10.136.` thì ra các IP bắt đầu như vậy;
    - MAC: gõ kiểu nào cũng được (`aa:bb:cc`, `aabb.ccdd` của Cisco, `aa-bb-cc` của Windows, hay vài số cuối);
      gõ một IP thì không tra nhầm sang MAC;
    - nhóm đầu cuối.
  - Mỗi kết quả kèm các **sơ đồ đang vẽ nó**. Cụm không nằm trực tiếp trên sơ đồ thì lấy sơ đồ của các thành viên.
    Mọi query lọc theo organization_id; có test chứng minh tổ chức khác không đọc được.
  - **Ctrl+K**:
    - Từ 2 ký tự trở lên thì gọi API (chờ 250 ms sau khi ngừng gõ) và hiện các nhóm Thiết bị / Cụm / Địa chỉ IP / Địa chỉ MAC / Nhóm đầu cuối.
    - Mỗi kết quả có thêm dòng "→ mở trên sơ đồ «…»".
    - Bỏ danh sách 200 thiết bị tải sẵn. Bộ lọc tại chỗ đổi từ "đoán gần đúng" sang "chứa đủ các từ đã gõ", không phân biệt dấu:
      trước đây gõ "cjidc" lại ra "CJ Foodville".
  - **Editor** đọc `?focus=<id>`: chọn node đó (với cụm thì chọn thành viên đầu tiên), zoom tới, rồi bỏ tham số khỏi URL.
  - Agent review song song đã chỉ ra, và đã sửa:
    - subnet và IPv6 không tìm được;
    - gõ "10.0.0.1" ra cả .10 đến .19;
    - gõ IP mà vẫn tra MAC;
    - cụm không tìm được theo tên;
    - kết quả MAC không có thứ tự cố định.
- Test / cách kiểm tra:
  - `search_test.go` (TestGlobalSearch): mọi kiểu tìm ở trên, ký tự `%` và `_` được hiểu là chữ thường, kiểm tra chéo tổ chức, và lỗi 400 khi chỉ gõ 1 ký tự.
  - App.test: Ctrl+K gọi API và hiện dòng "mở trên sơ đồ".
  - Kiểm tra trên trình duyệt với dữ liệu mẫu CJ Foodville: gõ `10.136.4.101` ra VIP của cụm; gõ `cjidc` ra 2 thiết bị và 1 cụm;
    bấm "CJIDC-HA → mở trên sơ đồ" thì mở sơ đồ, chọn sẵn VPN_CJIDC và zoom tới.
  - `make check` pass.
- Còn dở / lỗi đã biết:
  - Tìm kiếm dùng `LIKE '%…%'`, không dùng được index; với dữ liệu cỡ SRS thì đủ, sẽ đo ở P1-25.
  - Việc tìm "sơ đồ nào đang vẽ thiết bị này" phải quét JSON của mọi sơ đồ trong tổ chức. Nếu P1-25 đo thấy chậm,
    sẽ đề xuất thêm bảng `diagram_refs` cập nhật mỗi lần lưu.
  - Site và danh mục vẫn lọc ngay trên trình duyệt (đã tải sẵn toàn bộ). Chưa tìm được VLAN và subnet theo tên hoặc mô tả.
- Câu hỏi cho người dùng: không có.
- Đề xuất quyết định cần chốt: nếu benchmark P1-25 chậm thì có dùng extension `pg_trgm` của Postgres (index cho tìm chuỗi) không? Việc này cần ADR.
- Task tiếp theo đề xuất: P1-24 Dashboard cơ bản.

## 2026-10-17 — P1-22 Export (phần 2): file .ntb.json v2 xuất / nhập (ADR-037)
- Đã làm:
  - **Schema v2** `schema/ntb.schema.json` (theo tên trường của API); schema cũ + file mẫu cũ chuyển sang `schema/legacy/`, `testdata/legacy/`
    (prototype `/editor` vẫn chạy). Backend nhúng bản sao (`internal/ntbschema`, test bảo đảm trùng bản gốc) và kiểm tra file nhập.
  - **Xuất** (hộp "Xuất ảnh sơ đồ" → định dạng "Dữ liệu .ntb.json"): backend dựng file gồm sơ đồ, thiết bị (cổng, IP), dây, cụm, nhóm
    đầu cuối, dải IP của nhóm, subnet chứa IP, site (mã + tên); không có mật khẩu; audit `export.diagram_ntb`.
  - **Nhập** (Sơ đồ → "Nhập .ntb.json"): chọn file → máy chủ kiểm tra + đề xuất site đích (cùng mã/tên) → người dùng ghép site, chọn cách
    xử lý thiết bị trùng hostname (mặc định dùng thiết bị có sẵn / cập nhật / tạo mới / bỏ qua) → nhập trong một transaction, id mới,
    mở sơ đồ mới. Nhập lần 2 không nhân bản thiết bị, cụm, nhóm, dây. Cổng/IP tạo theo file cho thiết bị mới; khung gắn site đích.
  - Nginx: `client_max_body_size 25m` cho `/api` (file sơ đồ và lô nhập Excel lớn hơn mặc định 1 MB).
- Test / cách kiểm tra: `make check` pass (Go `TestNtbExportImport`: file xuất đúng schema; tổ chức B không xuất được sơ đồ của A; nhập
  thiếu site đích / site của tổ chức khác bị từ chối; nhập vào B tạo 3 thiết bị (2 thành viên cụm cùng hostname), 3 dây, 1 nhóm, 1
  cụm; cổng + IP của switch giữ nguyên; trùng tên sơ đồ 409; nhập lần 2 dùng lại hết, sơ đồ thứ hai trỏ đúng 2 thành viên cụm;
  `TestEmbeddedCopyIsTheSource`, `TestValidate`). Chromium: xuất sơ đồ mẫu (10 thiết bị, 9 dây, không có chữ "password") → nhập lại
  → sơ đồ mới 10 thiết bị, 9 dây, dùng lại thiết bị có sẵn.
- Còn dở / lỗi đã biết: location/rack không đi theo file; subnet/dải IP không tự tạo khi nhập (nhóm được cảnh báo để gắn lại dải);
  API chưa tự giới hạn dung lượng body (dựa vào Nginx) — để P2-01.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: ADR-037 (đã theo lựa chọn của người dùng).
- Task tiếp theo đề xuất: P1-23 Tìm kiếm toàn cục.

## 2026-10-17 — P1-22 Export (phần 1): ảnh PNG/SVG có chú giải, Excel thiết bị, audit export; sửa lỗi từ rà soát
- Đã làm:
  - **Xuất ảnh sơ đồ** (nút trên toolbar): PNG 1x–4x hoặc SVG; có tiêu đề + ngày xuất phía trên, **chú giải** các loại dây / trạng
    thái đang dùng phía dưới (mẫu nét lấy đúng CSS của sơ đồ). Toàn bộ sơ đồ được chụp kể cả phần ngoài màn hình (tạm vừa màn hình,
    bỏ chọn, chờ phông chữ, rồi trả lại khung nhìn và vùng chọn); ảnh quá lớn tự hạ độ nét trong giới hạn trình duyệt. html-to-image
    (đã có trong Stack) — ghi tạm nét SVG trực tiếp lên từng đường khi chụp vì thư viện không chép kiểu nét của SVG.
  - **Xuất Excel danh sách thiết bị** (nút "Xuất Excel" ở Kho → Thiết bị): mọi trang theo bộ lọc đang chọn, đúng cột của file nhập
    (Site = công ty, Location = mã site, Category = mã loại…) + vài cột tham khảo; **không có cột mật khẩu**. Bộ nhập nhận mã loại
    (l2_switch, vpn_gateway…) để vòng xuất → nhập khớp.
  - **Audit export**: `POST /orgs/{orgId}/export-events` ghi `export.diagram_png|svg`, `export.devices_xlsx` (sơ đồ phải là sơ đồ người
    dùng xem được).
  - Sửa lỗi từ rà soát: nhóm đầu cuối sửa lần 2 sau khi lưu không còn báo xung đột (làm mới version sau lưu, chưa có version thì chưa
    cho Áp dụng); **dây gộp** hiện panel "Nhóm dây" (số dây, dải cổng) thay vì sửa nhầm 1 dây, nhấp đúp không mở hộp sửa 1 dây; dải
    cổng không còn lệch 1 cổng và tự xóa khi đổi cổng đầu; công cụ vẽ khung xử lý kéo bị hủy và lấy đúng điểm thả; ô IP quản trị ghi
    audit khi tạo interface quản trị và khi đặt interface quản trị.
- Test / cách kiểm tra: `make check` pass (Go `TestRecordExport`: ghi audit, sơ đồ tổ chức khác 404, chặn chéo tổ chức; vitest: vòng
  xuất Excel → bộ nhập đọc đúng, không có cột bí mật). Chromium: PNG/SVG tải về có dây + chú giải; xuất khi đang phóng to vẫn đủ sơ đồ
  và trả lại khung nhìn; Excel 10 dòng đúng cột.
- Còn dở / lỗi đã biết: SVG là ảnh "bọc HTML" (foreignObject), phóng to nét nhưng không sửa được bằng Illustrator như vector thuần;
  phần 2 của P1-22 (file `.ntb.json` xuất/nhập, schema mới) chưa làm.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-22 phần 2 — `.ntb.json`.

## 2026-10-17 — Editor: công cụ Khung vẽ bằng kéo chuột
- Bối cảnh: bấm "Khung" trước đây tự vẽ một khung giữa màn hình (hoặc quanh vùng chọn), trùm lên thiết bị của khung khác và kéo theo
  chúng khi di chuyển.
- Đã làm: bấm **Khung** (hoặc Ctrl+G khi không chọn gì) → chế độ vẽ khung: con trỏ thành dấu +, kéo trên màn vẽ để vẽ khung đúng
  chỗ/cỡ, thả chuột là tạo rồi quay về Con trỏ (kéo quá nhỏ = không tạo). Khung mới gắn site khi mọi thiết bị trong vùng vẽ cùng
  site, không gom gì khác. Esc / nút Con trỏ / Bàn tay / Nối dây đều thoát chế độ vẽ; nút Khung thuộc nhóm công cụ (được tô khi đang
  bật). **Ctrl+G khi đang chọn thiết bị** vẫn tạo khung bao quanh vùng chọn.
- Test / cách kiểm tra: `make check` pass. Chromium: bấm Khung → không tạo khung nào, có lớp vẽ con trỏ crosshair; kéo quanh router +
  switch HN → 1 khung, tự gắn site HN, lớp vẽ biến mất.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-22 Export.

## 2026-10-17 — Sơ đồ: ký hiệu cổng gọn g1/0/24
- Đã làm: nhãn cổng ở hai đầu dây mặc định kiểu **gọn** (`g1/0/24`, `te1/1/1`, `po1`, `tu1`); cài đặt sơ đồ (panel khi không chọn gì) có
  ô **"Ký hiệu cổng"**: gọn / kiểu Cisco (`Gi1/0/24`) / đầy đủ (`GigabitEthernet1/0/24`), lưu theo sơ đồ (`view.portStyle`, backend kiểm
  giá trị). Tên cổng hãng khác (port1, wan1, ether1, ge-0/0/1) giữ nguyên; nhãn dây gộp ("g1/0/1–10 (10)") cũng theo kiểu đã chọn.
  Ghi chú: nhãn cổng ẩn khi thu nhỏ dưới 50 % (sơ đồ vẽ từ Excel mở ở ~44 % nên lúc đầu không thấy nhãn).
- Test / cách kiểm tra: `make check` pass (vitest `portLabel`). Chromium: sơ đồ mẫu hiện g1/0/21…24, g0/0/0, tu1.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-22 Export.

## 2026-10-17 — Panel thuộc tính: chọn màu tự do
- Đã làm: mọi chỗ chọn màu trong panel (nhãn thiết bị/nhóm, nhiều đối tượng, khung, chữ, mũi tên) có thêm ô **"Màu tùy chọn"** (bảng
  chọn màu của hệ điều hành) cạnh 6 màu có sẵn; kéo chọn liên tục = một bước hoàn tác. Màu tự do lưu dạng `#rrggbb`, vẽ inline (nhãn:
  pha 18 % như màu có sẵn; khung: viền/nền theo màu; chữ, mũi tên: màu chữ). Backend chỉ nhận tên màu có sẵn hoặc `#rrggbb` cho
  `labelStyle.color` và màu chú thích (chặn chuỗi CSS lạ).
- Test / cách kiểm tra: `make check` pass (Go `TestDiagramColours`: hex/tên màu nhận, chuỗi CSS và hex thiếu ký tự bị từ chối).
  Chromium: chọn #ff6600 cho nhãn ISR → nhãn đổi màu, lưu được.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor, hoặc P1-22 Export.

## 2026-10-17 — Đầu cuối trên sơ đồ (ADR-036): nhóm đại diện, nối dải cổng, cấu hình trong panel
- Đã làm:
  - Thư viện sơ đồ có mục **"Đầu cuối (không vào kho)"** (PC, laptop, máy in, điện thoại IP, họp trực tuyến, camera, chấm công, IoT,
    khác). Kéo/bấm → hộp "Thêm đầu cuối" (loại, site, tên — gợi ý sẵn, số lượng); tùy chọn "Quản lý từng máy trong kho" để tạo thiết bị
    như cũ. Nhóm là nháp, tạo khi lưu sơ đồ (thao tác `createEndpointGroup`/`updateEndpointGroup` mới của lần lưu, có hoàn tác).
  - **Panel nhóm:** tên, loại, số lượng, site, subnet → dải IP (chọn có sẵn hoặc **tạo dải mới** — ghi IPAM ngay), ghi chú; mục "Cắm
    vào" liệt kê cổng theo dải ("SW-POE: Gi1/0/1–24 (24)").
  - **Nối dải cổng:** nhóm ↔ thiết bị có ô "Đến cổng (nối cả dải)" → mỗi cổng một link, một bước hoàn tác; bỏ qua cổng đã có dây.
  - **Sơ đồ:** các dây của một nhóm tới cùng thiết bị gộp thành một cạnh, nhãn "Gi1/0/1–10 (10)"; Shift+Delete trên cạnh đó xóa cả
    nhóm dây. Nút nhóm có biểu tượng đúng loại và "×số lượng", dòng phụ là dải IP.
  - Backend: tách `writeGroup` (dùng trong lưu sơ đồ). ADR-036; Glossary. Sửa test MFA chập chờn (chờ editor tải lười tới 5 s).
- Test / cách kiểm tra: `make check` pass (Go `TestDiagramSaveEndpointGroups`: tạo nhóm + 3 dây trong một lần lưu, sửa nhóm, không thành
  thiết bị, site tổ chức khác bị từ chối; vitest 281: gộp cạnh, thứ tự thao tác lưu, một lần hoàn tác bỏ cả dải dây, rút gọn tên
  cổng). Chromium: thêm "Camera tầng 1" ×24 từ thư viện, nối cổng 1–10 của switch HCM, lưu → 1 nhóm, 10 dây, 0 thiết bị mới.
- Còn dở / lỗi đã biết: sửa loại/trạng thái dây cho cả nhóm dây một lần chưa có (hộp sửa dây chỉ sửa dây đại diện); thư viện tab
  "Trong kho" chưa liệt kê nhóm đầu cuối có sẵn để đặt lại lên sơ đồ khác.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: sửa cả nhóm dây; nhóm đầu cuối trong tab "Trong kho"; hoặc P1-22 Export.

## 2026-10-17 — Editor: kéo cả nhóm site, thanh tiêu đề khung dễ nắm
- Đã làm: thanh tiêu đề khung có biểu tượng tay nắm + chú thích "Kéo để di chuyển cả site…"; khi thu nhỏ màn vẽ (< 80 %) tiêu đề giữ cỡ
  đủ lớn để nắm/đọc (tối đa 2,5×, cắt chữ trong bề rộng khung). **Shift + bấm tiêu đề** chọn thêm site; kéo một tiêu đề → mọi khung đã
  chọn cùng thiết bị bên trong dời theo, một bước hoàn tác (Alt: chỉ dời khung).
- Test / cách kiểm tra: `make check` pass. Chromium: kéo khung HN bằng tiêu đề (khung + router dời 222 px); Shift chọn HN + HCM, kéo →
  router HN, switch HCM và khung HCM cùng dời 169 px; Ctrl+Z trả về vị trí cũ.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor, hoặc P1-22 Export.

## 2026-10-17 — Panel thuộc tính: nhập IP quản trị trực tiếp
- Đã làm: ô **IP quản trị** trong phần Sửa nhanh của panel thiết bị (gõ IP → Lưu/Enter), ghi thẳng vào kho (ADR-034). Endpoint mới
  `PUT /orgs/{orgId}/devices/{deviceId}/mgmt-ip`: đặt IP lên interface quản trị (thay IP chính cùng họ địa chỉ); chưa có interface quản
  trị thì tạo `Vlan1` (switch) / `mgmt` (thiết bị khác) và đặt làm interface quản trị; không ghi mask → lấy theo subnet IPAM, không có
  thì /32 + cảnh báo; IP đang dùng ở thiết bị khác cùng VRF → cảnh báo (bỏ qua thành viên cùng cụm). Audit `ip.create`/`ip.update`.
  Ô bị khóa khi thiết bị có sửa chưa lưu trên sơ đồ (tránh lần lưu sơ đồ ghi đè interface quản trị).
- Test / cách kiểm tra: `make check` pass (Go `TestSetDeviceMgmtIP`: tạo interface `mgmt`, /32 + cảnh báo, lấy mask từ subnet khi có,
  thay chứ không thêm IP, switch dùng Vlan1, cảnh báo trùng, IP sai 400, chặn chéo tổ chức). Chromium: modem chưa có cổng → gõ
  192.168.1.1 + Enter → nút trên sơ đồ hiện IP ngay.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor, hoặc P1-22 Export.

## 2026-10-17 — Hộp nối dây: đầu không cần cổng nói rõ, khung "chưa có cổng" không còn giống lỗi
- Bối cảnh: nối Internet → modem, người dùng tưởng bị báo lỗi "không có cổng Internet" (ô cổng bị khóa + khung vàng). Thực ra nối được.
- Đã làm: đầu không có cổng (mạng nhà cung cấp, nhóm đầu cuối, dây nguồn ở đầu thiết bị…) hiện "Không cần cổng ở đầu này" thay cho ô
  chọn bị khóa, kèm giải thích; khung "<thiết bị> chưa có cổng" đổi sang màu trung tính, ghi rõ "có thể nối dây ngay và gán cổng
  sau"; không có model thì ghi "Thêm các cổng thường có của <loại>".
- Test / cách kiểm tra: `make check` pass. Chromium: Internet (HCMC-HQ) → modem chưa có cổng → loại dây tự chọn DSL, bấm Nối → dây
  xuất hiện trên sơ đồ.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: như mục trước (HCM ra Internet qua đâu).
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor, hoặc P1-22 Export.

## 2026-10-17 — Thêm cổng tại chỗ: đoán theo loại thiết bị khi không có model
- Đã làm: thiết bị chưa có model (vd modem tạo nhanh trên sơ đồ) → "Thêm các cổng này" đề xuất mặt trước điển hình theo loại:
  ONT `PON` + `LAN1–4`; modem `DSL` (xDSL) + `LAN1–4`; router/firewall/SD-WAN/VPN `WAN` + `LAN1–4`; AP `LAN` (trước đây đề xuất
  8 cổng `Gi…` cho mọi loại).
- Giải thích cho người dùng: "Internet / nhà mạng" không có cổng (mạng của nhà mạng) — nối được, chỉ chọn cổng ở đầu thiết bị; đi đúng
  thực tế: Internet → modem/ONT → WAN của router/firewall → switch (switch L2 không đứng ngay sau đường Internet).
- Test / cách kiểm tra: `make check` pass (vitest: đoán cổng theo loại).
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: văn phòng HCM (4 switch C1300, không có router/firewall trong danh sách) ra Internet qua đâu — modem nhà mạng
  làm router luôn, hay VPN về FortiGate ở IDC?
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor, hoặc P1-22 Export.

## 2026-10-17 — Editor: công cụ Bàn tay, Space + kéo
- Đã làm: nút **Bàn tay** trên toolbar (phím **H**): bật thì kéo chuột trái ở bất kỳ đâu — kể cả trên thiết bị/khung — để di chuyển
  màn vẽ, không thiết bị nào bị kéo theo. **Giữ Space + kéo chuột trái** luôn di chuyển màn vẽ (không cần bật bàn tay); con trỏ đổi
  thành bàn tay; Space không còn "bấm" nhầm nút đang focus hay cuộn trang (trừ khi đang gõ trong ô nhập / hộp thoại). Chuột giữa vẫn
  kéo được như cũ. SRS §6 cập nhật.
  - Bổ sung theo phản hồi: nút **Con trỏ** (phím **V**) cạnh Bàn tay — luôn đúng một công cụ được bật (con trỏ / bàn tay / nối dây);
    bấm Con trỏ là thoát bàn tay và chế độ nối dây.
- Test / cách kiểm tra: `make check` pass (vitest: phím H). Chromium: Space + kéo đổi viewport khi nút Lưu đang focus (không lưu);
  bật bàn tay, kéo bắt đầu trên VPN_CJIDC → viewport đổi, thiết bị đứng yên, sơ đồ vẫn "Đã lưu".
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor theo góp ý, hoặc P1-22 Export.

## 2026-10-17 — Editor: thu nhỏ panel Thư viện / Thuộc tính
- Đã làm: mỗi panel có nút **thu nhỏ** (cạnh nút đóng) → panel gọn thành dải dọc ở mép màn vẽ ("Thư viện" bên trái, "Thuộc tính" bên
  phải), bấm dải để mở lại. Nút trên toolbar và phím B: panel đang thu nhỏ thì mở rộng, còn lại bật/tắt như cũ. Trạng thái nhớ theo
  trình duyệt (prefs `libraryMin`/`panelMin`); "vừa màn hình" tính theo panel đang mở rộng.
- Test / cách kiểm tra: `make check` pass (vitest: quy tắc nút toolbar với panel thu nhỏ). Chromium: thu nhỏ cả hai, mở lại thư viện,
  tải lại trang vẫn giữ trạng thái.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tiếp tục tối ưu editor theo góp ý, hoặc P1-22 Export.

## 2026-10-17 — P1-21b sửa: template hệ thống dùng trực tiếp, tự nhận theo model (ADR-035 sửa)
- Đã làm (theo phản hồi: "đã tạo template nhưng không thấy", người dùng chỉ cần gõ đúng model là có thông số):
  - Template trong thư viện = **template hệ thống**, dùng trực tiếp, không chép vào tổ chức. Thiết bị tạo từ đó lưu `catalog_id`
    (migration 000022), có đủ cổng, hãng/model/part number/số U.
  - **Trang Template**: tab "Template hệ thống (359)" — tìm, lọc hãng, bấm để xem nhóm cổng + nguồn datasheet, "Sao chép để sửa";
    tab "Template tự tạo".
  - **Tự nhận theo model** ở: form thêm thiết bị (gõ Model/Part number → chọn sẵn template, loại, số U), hộp thêm thiết bị trên sơ đồ
    (thêm ô Model), nhập Excel (không còn bước chép template), tab Cổng của thiết bị (chọn sẵn theo model), "Dùng cổng theo thư
    viện" trong hộp nối dây/panel. Template tự tạo luôn được ưu tiên hơn template hệ thống cùng model.
  - Ô chọn template chung (`TemplatePicker`): nhóm "Template tự tạo" + "Template hệ thống · <hãng>".
- Test / cách kiểm tra: `make check` pass (Go `TestDeviceFromSystemTemplate`: tạo thiết bị từ template hệ thống → đủ cổng, không chép
  template, id lạ bị từ chối, áp template hệ thống cho thiết bị chưa có cổng). Chromium: trang Template 2 tab; gõ "C1300-24T-4G" trong
  form → tự chọn template hệ thống, lưu ra thiết bị 29 cổng, tổ chức vẫn 0 template tự tạo.
- Còn dở / lỗi đã biết: trang chi tiết thiết bị chưa hiện dòng "Tạo từ template hệ thống …" (đã lưu `catalogId`); thư viện sơ đồ (tab
  Thêm mới) chỉ liệt kê template tự tạo — template hệ thống dùng qua ô Model trong hộp thêm thiết bị.
- Câu hỏi cho người dùng: như mục P1-21.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-22 Export.

## 2026-10-17 — P1-21b Thư viện thiết bị có sẵn (ADR-035)
- Đã làm:
  - **Thư viện 359 model** (247 đã đối chiếu datasheet), file JSON trong `backend/internal/catalog/data/`, nhúng vào binary, chỉ đọc:
    Cisco (Catalyst 1000/1200/1300/9200/9300/2960, CBS, ISR 1100/4000, C8200/8300, Meraki) và Fortinet (FortiGate 40F–600F,
    FortiSwitch, FortiAP) — 137; TP-Link Omada/JetStream/ER/EAP, Ubiquiti UniFi, MikroTik — 72; Aruba Instant On/CX/2530/2930F,
    Huawei S/AR/USG, Juniper EX/SRX/Mist — 83; Sophos XGS/XG, Palo Alto PA, DrayTek Vigor, Ruijie/Reyee, ONT Huawei/ZTE/VNPT — 67.
    Mỗi model: loại, part number/tên khác, số U, nhóm cổng đúng tên CLI (`{m}` cho dòng stack), cờ `verified` + nguồn.
  - Backend: `GET /orgs/{orgId}/device-catalog`; `POST /orgs/{orgId}/device-templates/from-catalog` chép thành template của tổ chức
    (audit `template.create`; tổ chức đã có template cùng tên / model / part number thì trả template đó, không nhân bản).
  - **Nhập Excel**: model chưa có template nhưng có trong thư viện → khung "Tạo template từ thư viện" ở bước Xem trước (bỏ chọn
    được); nhập xong thiết bị có đủ cổng. Loại "Switch" chung chung được chỉnh theo thư viện (vd switch PoE).
  - **Thêm cổng tại chỗ** (hộp nối dây / panel): model có trong thư viện → nút "Dùng cổng theo thư viện" trước phần đoán.
  - **Trang Template**: nút "Thêm từ thư viện" — tìm theo từng từ ("omada sg2210"), lọc theo hãng.
  - ADR-035; Glossary "Template thiết bị / Thư viện thiết bị".
- Test / cách kiểm tra: `make check` pass (Go `TestCatalogData`: mọi model là template hợp lệ, cả thành viên stack 2;
  `TestTemplateFromCatalog`: tạo, gọi lại trả template cũ, model lạ 404, chặn chéo tổ chức; vitest 277). Chromium (môi trường
  riêng, chưa có template): nhập file 8 dòng → tự tạo 4 template → C1300 có GigabitEthernet1/0/1–28, FortiGate wan1/wan2/internal1–6,
  ISR4331 Gi0/0/0–2 + Gi0; hộp "Thêm từ thư viện" tìm đúng.
- Còn dở / lỗi đã biết:
  - 112 model chưa đối chiếu được (giao diện ghi "chưa đối chiếu datasheet — nên kiểm tra"), đáng chú ý: CBS110/220/250 (tên cổng
    GE1…), Catalyst 2960-X, Catalyst 1200 (cách đặt tên), Meraki MX, một số router Huawei/DrayTek/Reyee, ONT ZTE.
  - Huawei và Juniper dùng số slot cố định 0 (`GigabitEthernet0/0/x`, `ge-0/0/x`): trong stack/virtual chassis số slot đổi theo thành
    viên — sửa template nếu dùng stack.
  - IP quản trị khi nhập vẫn gắn vào `Vlan1` (switch) / `mgmt` ảo (thiết bị khác), không tự dùng cổng quản trị ngoài băng của template.
  - Tổ chức CJ trên máy dev đã có template tự tạo "Fortinet FortiGate 80F" (21 cổng) → được dùng lại thay cho bản thư viện (11 cổng).
- Câu hỏi cho người dùng: như mục P1-21.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-22 Export.

## 2026-10-17 — P1-21 bổ sung: thêm cổng tại chỗ, khung site ôm thiết bị
- Đã làm (theo phản hồi sau khi nhập thử trên máy dev):
  - **Thiết bị nhập không có template thì không có cổng**: ISR4331, CBS220, C1300 chưa có template trong tổ chức nên chỉ có
    `Vlan1` (ảo), vì vậy hộp nối dây chỉ hiện "Vlan1 (không cắm được)". Sửa:
    - Hộp **Nối/Sửa dây** và panel **Thuộc tính → Cổng**: thiết bị chưa có cổng vật lý hiện khung "chưa có cổng để cắm dây",
      kèm **áp dụng template cùng loại** hoặc **"Thêm các cổng này"** — cổng đoán theo model (C1300-24T-4G → 24 cổng đồng
      GigabitEthernet1/0/1–24 + 4 SFP 1/0/25–28; CBS220 → GigabitEthernet1–28; ISR4331 → Gi0/0/0–2; FortiGate → wan/port), sửa
      được mẫu tên/số lượng/loại/tốc độ. Ghi vào kho ngay (như IPAM trong panel, ADR-034); dây vẫn lưu cùng sơ đồ.
    - Backend: `apply-template` nhận thêm `ports` (nhóm cổng khai tại chỗ, cùng định dạng template) — đúng một trong hai.
    - Màn **Nhập Excel** cảnh báo trước các model chưa có template (dòng xem trước + hộp cảnh báo, link tới trang Template).
  - **Khung site ôm thiết bị khi kéo**: kéo thiết bị đang nằm trong khung của chính site nó → khung tự co giãn để ôm trọn các
    thiết bị của site trong khung (khung lồng nhau: khung nhỏ nhất). Cùng một bước hoàn tác với lần kéo.
- Test / cách kiểm tra: `make check` pass (Go: nhóm cổng tại chỗ, từ chối khi có cả template lẫn cổng hoặc không có gì; vitest 276:
  đoán cổng theo model, thành viên khung theo site). Chromium (môi trường riêng): nhập 8 dòng → vẽ sơ đồ → kéo switch HCM ra
  ngoài, khung HCM giãn theo; panel thêm 28 cổng cho C1300; hộp nối dây hiện GigabitEthernet1/0/x, đầu kia hiện "Thêm các cổng".
- Còn dở / lỗi đã biết: đoán tên cổng theo model chỉ là đề xuất (cần xác nhận); thêm cổng cho cả loạt thiết bị cùng model một lần
  — nên tạo template rồi áp dụng (trang thiết bị) — chưa có nút "áp dụng cho mọi thiết bị cùng model".
- Câu hỏi cho người dùng: như mục P1-21.
- Đề xuất quyết định cần chốt: khung tự ôm khi kéo có nên **thu nhỏ** khi kéo thiết bị vào trong (đang: vừa khít các thiết bị của
  site trong khung, tức có thu nhỏ)?
- Task tiếp theo đề xuất: P1-22 Export.

## 2026-10-17 — P1-21 Import Excel thiết bị
- Đã làm:
  - **Trang "Nhập Excel"** (Kho → Thiết bị → nút "Nhập Excel"), các bước trên một trang:
    1. Chọn file (.xlsx/.csv); tải được file mẫu.
    2. Tự nhận dòng tiêu đề (bỏ qua các dòng như "Person in charge: GVN" phía trên, lấy làm người phụ trách chung) và ánh xạ
       cột: Site → Danh mục (công ty), Location → Site, Category → loại thiết bị. Ô gộp (merge) được điền xuống mọi dòng.
    3. Xác nhận giá trị: công ty → danh mục; địa điểm → site có sẵn hoặc "Tạo site mới" (gợi ý mã); loại thiết bị.
    4. Xem trước từng dòng: lỗi trong file (trùng hostname/S/N, trùng IP không cùng cụm) và nút "Kiểm tra" chạy thử trên máy chủ.
    5. Nhập theo lô 200 dòng, có thanh tiến trình, kết quả từng dòng.
    6. **"Vẽ sơ đồ từ kết quả"**: tạo sơ đồ mới, mỗi site một khung, thiết bị xếp sẵn bên trong.
  - Ánh xạ thông minh:
    - Tên gần giống được **đề xuất** (cần bấm xác nhận), không tự gộp. Ví dụ "HaNoi" → "Văn phòng Hà Nội", "Hochiminh" → "Văn
      phòng Hồ Chí Minh (HQ)", không nhầm sang "FPT IDC HCM" (so phần lõi tên, bỏ các từ chung văn phòng/IDC/HQ…).
    - Từ PartNumber đoán hãng/model ("FortiGate 80F" là model của Fortinet; "ISR4331/K9" → Cisco ISR4331); khớp template của tổ
      chức → tự sinh cổng.
    - Các dòng **cùng IP + cùng site + cùng loại** → đề xuất **cụm HA** (firewall/router) hoặc stack (switch hỗ trợ stack). IP
      thành IP chung của cụm, không báo trùng. Máy chính tạm lấy dòng đầu (hostname có slave/backup xếp sau) — cần xác nhận.
  - **Mật khẩu/tài khoản**: cột Password/User name bị bỏ qua, không đọc vào, không gửi lên máy chủ (kho mật khẩu ở P2-02);
    giao diện nhắc xóa file sau khi nhập.
  - **Backend** `POST /orgs/{orgId}/device-imports`: mỗi dòng đi qua đúng logic của form thiết bị (`writeDevice`) trong savepoint
    riêng — dòng lỗi được báo, dòng khác vẫn vào; `dryRun` rollback toàn bộ (thấy cả trùng trong file). Chế độ cập nhật theo
    hostname / S/N / chỉ tạo mới; ô trống không xóa dữ liệu cũ; S/N giả (N/A, -, 0…) không dùng để khớp. IP quản trị: thiếu mask
    thì lấy theo subnet IPAM, không có subnet thì lưu /32 kèm cảnh báo; interface quản trị: cổng có sẵn cùng tên, nếu không có
    thì tạo `Vlan1` (switch) hoặc `mgmt` (interface ảo tạm). Audit từng thiết bị + một mục `device.import` tổng.
  - **Sửa lỗi P1-20 từ rà soát:** dây mới chưa lưu cắm vào cổng chưa dùng giờ được kiểm tra; lệch tốc độ chỉ xét dây ethernet/
    quang, hiểu "1G" = "1000M", hạ xuống Ghi chú; RJ45↔SFP hạ xuống Ghi chú (có module SFP đồng); hai đầu L3 so cả hai chiều
    (bắt lệch mask); loopback/tunnel không bị báo "địa chỉ mạng"; Worker lỗi thì tự chạy trực tiếp; thiết bị vẽ 2 lần không tự
    báo trùng tên.
  - Thư viện mới: SheetJS (`xlsx` 0.20.3 từ CDN chính thức — bản npm cũ có lỗ hổng), đã có trong Stack.
- Test / cách kiểm tra: `make check` pass (Go `TestDeviceImport`: chạy thử không ghi gì, cụm + VIP lấy mask theo subnet, thành viên
  cụm không có IP riêng, switch có Vlan1 + IP /32 + cảnh báo, nhập lại theo hostname cập nhật không xóa ghi chú/không nhân IP/cụm,
  chỉ-tạo-mới báo lỗi, tổ chức B không ghi được vào site của A; `TestValidationContext` thêm cổng của dây chưa lưu; vitest 272 —
  test đọc đúng file mẫu của khách, gộp ô, cột mật khẩu không lọt vào dữ liệu gửi đi).
  Chromium (môi trường riêng, dựng giống máy dev: danh mục FOODVILLE + 3 site, chưa có thiết bị): nhập file 8 dòng giống ảnh
  `docs/demo/devices.png` → tạo 8, lỗi 0, 1 cụm HA; "Vẽ sơ đồ" ra 3 khung đúng site; không request nào chứa mật khẩu.
- Còn dở / lỗi đã biết: chưa tạo **danh mục mới** từ màn import (chỉ chọn danh mục có sẵn hoặc "thẳng dưới tổ chức"); nhập chạy
  trong trang (phải để trang mở tới khi xong), chưa phải job nền; chưa có test App cho trang import (logic có unit test + e2e tay).
- Câu hỏi cho người dùng: hai câu ở mục P1-20 (chặn trùng IP/serial khi ghi; vai trò IP `vip` cho VRRP/HSRP) vẫn chờ chốt.
- Đề xuất quyết định cần chốt: interface quản trị tạo khi import (`Vlan1` cho switch, `mgmt` ảo cho thiết bị khác) và lưu /32 khi
  chưa có subnet — đang làm như vậy, cần ghi ADR nếu đồng ý.
- Task tiếp theo đề xuất: P1-22 Export (PNG/SVG, Excel, .ntb.json).

## 2026-10-17 — P1-20 Validation (kiểm tra sơ đồ)
- Đã làm:
  - **Bộ rule chạy trong Web Worker** (`frontend/src/editor/checks/`), 300 ms sau thay đổi cuối, có fallback chạy trực tiếp khi
    không có Worker. Rule tính trên dữ liệu kho + thay đổi chưa lưu trên sơ đồ (dây mới/sửa/xóa, cổng của thiết bị mới).
    - **Lỗi:** IP không gán được (sai định dạng, 0.0.0.0, multicast, loopback, 169.254.x); trùng IP cùng VRF; trùng hostname
      (kể cả thiết bị chưa lưu trên sơ đồ); trùng serial; một cổng vật lý > 1 dây (trừ PON/wireless/4G/logical); dây vật lý cắm
      vào interface ảo/LAG.
    - **Cảnh báo:** IP là địa chỉ mạng/broadcast (IP trần lấy mask theo subnet IPAM dài nhất cùng VRF); RJ45 ↔ SFP; hai đầu khác
      tốc độ; hai đầu L3 khác subnet (theo họ IPv4/IPv6, bỏ /32, cổng access/trunk; cổng thành viên dùng IP của LAG); IP thành
      viên ngoài dải nhóm; VLAN không khớp chế độ cổng (access/trunk/routed); LAG khác tốc độ; cụm khác firmware / khác model (HA);
      thiết bị trong khung site/location khác.
    - **Ghi chú:** thiết bị không có dây (tính cả dây không vẽ trên sơ đồ này); dây chưa gán cổng; có IP nhưng chưa chọn interface
      quản trị; LAG khác loại cổng cùng tốc độ; stack khác model.
  - **Backend** `POST /orgs/{orgId}/validation-context`: dữ liệu rule cần cho các thiết bị/nhóm trên sơ đồ (chỉ gửi cổng có dây/IP/
    LAG/VLAN để payload nhỏ) + xung đột toàn tổ chức: trùng hostname, serial (bỏ trống/placeholder, retired), IP cùng VRF (gom theo
    "chủ": các thành viên cụm và VIP của cụm là một; bỏ retired và IPv6 link-local; bản NAT/public hoặc thiết bị planned/spare/RMA →
    cảnh báo). Lọc theo organization_id, test chứng minh tổ chức B không thấy dữ liệu A.
  - **Panel Vấn đề**: nút trên toolbar hiện tổng số + biểu tượng mức nặng nhất; panel lọc theo mức, mỗi dòng có "cách sửa" bằng lời
    dễ hiểu; bấm dòng → chọn thiết bị/dây và zoom tới. **Badge** trên node (hình + màu theo mức). Dữ liệu tự tải lại sau khi lưu và
    sau mỗi thao tác IPAM từ panel.
  - **Sửa lỗi P1-19 từ rà soát:** thân khung/hộp cụm không còn chặn khoanh chọn, click nền, chuột phải; khung đang chọn không nổi
    lên che thiết bị; mỗi lần đổi kích thước khung là một bước hoàn tác riêng (trước gộp chung); Delete khung + thiết bị là một bước.
  - SRS §7 cập nhật theo các mức đã chốt ở PLAN; Glossary: "Kiểm tra sơ đồ (Vấn đề)".
- Test / cách kiểm tra: `make check` pass (Go `TestValidationContext`: cụm, retired, NAT/public, serial không phân biệt hoa thường,
  chặn chéo tổ chức; vitest 259 — 17 test rule; App: context gửi đúng id, nút toolbar, panel, bấm dòng mở thiết bị).
  Chromium (môi trường riêng, dữ liệu CJ Foodville): panel hiện 1 cảnh báo + 1 ghi chú, bấm dòng chọn đúng router, không lỗi console.
- Còn dở / lỗi đã biết: chưa có badge trên dây (dây được chọn khi bấm dòng); "dải IP đầy" và "gateway ngoài subnet" chưa làm (thiếu dữ
  liệu gateway thiết bị); IP VRRP/HSRP dùng chung giữa 2 router không thuộc cụm sẽ bị báo trùng.
  **Dữ liệu demo:** router Hà Nội có IP WAN `27.72.96.43/30` — đây là địa chỉ broadcast của dải `27.72.96.40/30`, nhiều khả năng mask
  thật là khác (vd /29) hoặc IP gõ nhầm; nên kiểm tra lại thông tin nhà mạng.
- Câu hỏi cho người dùng:
  1. Trùng IP và trùng serial: hiện chỉ **báo** (không chặn), giống ADR-034. Có muốn API **từ chối** khi gán IP trùng/nhập serial trùng
     (và khi import Excel P1-21) không?
  2. IP ảo VRRP/HSRP trên 2 router độc lập: thêm vai trò IP `vip` (chỉ cho trùng khi mọi bản đều là `vip` cùng subnet)?
- Đề xuất quyết định cần chốt: (1) và (2) ở trên → ADR mới khi chốt.
- Task tiếp theo đề xuất: P1-21 Import Excel thiết bị (chạy lại các rule Error trên dữ liệu file, kể cả trùng trong file).

## 2026-10-17 — P1-19 Annotation & khung nhóm theo site/location
- Đã làm:
  - **Khung** (annotation `zone`, thêm `siteId` / `locationId` — ADR-032): nút "Khung" trên toolbar hoặc **Ctrl+G** tạo khung quanh
    các thiết bị đang chọn, tự gắn site chung của chúng (khác site thì báo và để chọn trong panel); Ctrl+Shift+G bỏ khung (thiết bị
    giữ nguyên). Tiêu đề theo site (mã · tên) và location, đặt tiêu đề riêng được; site đã xóa hiện "Site đã xóa". Kéo **thanh tiêu
    đề** để di chuyển khung **kèm thiết bị bên trong** (giữ Alt: chỉ khung), một bước hoàn tác; kéo mép để đổi kích thước. Thân khung
    không chắn chuột (vẫn khoanh chọn, click thiết bị/dây bình thường); khung không làm đầu dây khi nối.
  - **Thiết bị mới thả vào khung** nhận site (và location nếu khung gắn location cùng site) của khung nhỏ nhất chứa điểm thả.
  - **Hộp cụm tự động**: cụm có từ 2 thành viên trên sơ đồ được vẽ khung chấm nhãn "HA · CJIDC-HA" / "Stack · …" (suy từ kho, không
    vẽ tay).
  - **Chữ** (màu, cỡ chữ) và **mũi tên** (kéo hai đầu, nét liền/đứt, nhãn); panel thuộc tính cho khung/chữ/mũi tên; Delete xóa chú
    thích đang chọn.
  - Backend: kiểm tra annotation (kích thước, cỡ chữ 8–96, màu, kiểu nét, chỉ khung mới gắn site, location phải kèm site) và
    **site/location thuộc tổ chức** khi lưu (binding đã lưu trước vẫn giữ được nếu site bị xóa sau).
  - **Sửa lỗi P1-18 từ rà soát** (commit riêng): IP gán từ subnet giữ đúng VRF; chỉ đồng bộ version cho thao tác IPAM của chính
    mình (không đè sửa của người khác); hoàn tác thất bại có báo; ô nhập không bị xóa sau khi lưu cổng; cảnh báo dùng vùng
    thông báo (không như lỗi); IP ngoài subnet đã chọn được cảnh báo.
  - Glossary: "Khung site / location".
- Test / cách kiểm tra: `make check` pass (Go: `TestDiagramFrames` — site tổ chức khác, location khác site, cỡ chữ, kích thước…;
  vitest 241: thiết bị trong khung, khung nhỏ nhất, kéo khung kèm thiết bị, hộp cụm; App: Ctrl+G → khung gắn site → lưu).
  Chromium: 3 khung HCM / IDC / HN cho CJ Foodville, kéo khung IDC → cặp FortiGate đi theo, lưu; axe không lỗi.
- Còn dở / lỗi đã biết: chưa di chuyển/đổi kích thước khung bằng bàn phím; chú giải tự động và bảng IP plan để sau; cảnh báo
  "thiết bị nằm trong khung khác site" làm ở P1-20.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: SVI gắn VLAN (từ P1-18) vẫn chờ.
- Task tiếp theo đề xuất: P1-20 Validation.

## 2026-10-17 — P1-18 bước 2: IPAM trong panel (ADR-034)
- Đã làm:
  - Người dùng chốt **cách A** → ADR-034: thay đổi IPAM/interface từ panel ghi **thẳng** vào IPAM qua API sẵn có (không qua Ctrl+Z
    hay nút Lưu sơ đồ); mỗi lần ghi có thông báo kèm nút **Hoàn tác** chạy thao tác ngược; panel ghi rõ "lưu thẳng vào IPAM".
  - Panel thiết bị → **Cổng**: bấm một cổng để đặt **chế độ** (access / trunk / routed / hybrid — chỉ giữ trường của chế độ đó),
    **VLAN access** (chọn từ VLAN của site + toàn tổ chức, hoặc tạo VLAN mới tại chỗ), **VLAN cho phép + native** (trunk); xem/gỡ
    **IP** của cổng; **gán IP**: chọn subnet (hoặc tạo subnet tại chỗ) → "Lấy IP trống kế tiếp" → Gán (IP chính/phụ).
    Cảnh báo không chặn: VLAN chưa có trong IPAM, IP đang dùng ở thiết bị khác cùng VRF (bỏ qua thành viên cùng cụm), địa chỉ
    mạng/broadcast, IP ngoài mọi subnet. Thiết bị chưa lưu: phần cổng chỉ xem.
  - **Interface quản trị** chọn trong sửa nhanh (command, lưu cùng sơ đồ).
  - Sau mỗi lần ghi IPAM: version thiết bị trong sửa chưa lưu được cập nhật (không bị xung đột khi lưu sơ đồ), IP quản trị trên
    thẻ thiết bị làm mới — không tạo bước hoàn tác, trạng thái "Đã lưu" vẫn đúng (`syncDevice`).
- Test / cách kiểm tra: `make check` pass (vitest 236: địa chỉ mạng/broadcast, đồng bộ version/IP qua lịch sử; App: chế độ cổng +
  VLAN → PATCH interface, IP trống → POST IP, sơ đồ không "chưa lưu"). Chromium + API: ISR Gi0/0/2 → routed, subnet
  10.136.42.0/24 → IP trống 10.136.42.2 (bỏ qua gateway) → gán; API xác nhận; axe không lỗi.
- Còn dở / lỗi đã biết: chưa có nhãn subnet/IP trên dây sơ đồ (đề xuất làm cùng P1-20/annotation); SVI chưa gắn được với VLAN
  (cần quyết định trường mới — ghi nhận từ rà soát); "IP trống" không giữ chỗ (hai người cùng lấy có thể trùng, có cảnh báo).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: SVI gắn với VLAN (thêm trường `vlan` cho interface kiểu SVI để kiểm "một SVI mỗi VLAN" và
  "IP SVI thuộc subnet của VLAN").
- Task tiếp theo đề xuất: P1-19 Annotation & khung nhóm theo site/location.

## 2026-10-17 — P1-18 bước 1: Panel thuộc tính & hiển thị
- Đã làm:
  - **Panel thuộc tính** bên phải màn vẽ (bật/tắt trên toolbar, mặc định mở). Chọn thiết bị: IP quản trị (kể cả IP cụm), site,
    cụm, S/N, cổng và cổng nào đang nối tới đâu (tính cả dây chưa lưu), mở trang thiết bị; sửa nhanh hostname, loại, site, hãng,
    model, vai trò, vòng đời, quản lý, ghi chú → "Áp dụng" thành một bước hoàn tác, lưu cùng sơ đồ. Chọn dây: hai đầu + cổng, nút
    "Loại / cổng…", sửa trạng thái, biến thể cáp, tốc độ, mã cáp, chiều dài, SM/MM + đầu nối (chỉ dây quang), dịch vụ WAN/nhà
    mạng/circuit/băng thông (khi có dịch vụ hoặc một đầu là Internet/nhà mạng). Nhóm đầu cuối: tên, loại, mở trang. Không chọn gì:
    cài đặt sơ đồ — **mẫu nhãn** dưới thiết bị (Hostname + IP / model / mã site / IP + model / loại / chỉ hostname).
  - **Màu nhãn** theo thiết bị (bảng 6 màu đổi theo sáng/tối), đổi cho nhiều thiết bị một lúc; **viền nét đứt** cho thiết bị
    không quản lý (vd đám mây nhà mạng, modem ISP). "Vừa màn hình" chừa chỗ cho panel.
  - **Sửa lỗi từ rà soát:** sắp xếp theo IP quản trị và tìm theo IP giờ tính cả IP của cụm; dây "Dự kiến" không còn bị kiểu "chưa
    lưu" che mất.
- Test / cách kiểm tra: `make check` pass (Go: tìm/sắp theo IP cụm; vitest 233: mẫu nhãn, App: sửa nhanh thiết bị + mẫu nhãn +
  màu → lưu, panel chỉ đọc với người xem). Chromium: panel thiết bị/dây, axe không lỗi (đã sửa danh sách cổng cuộn bằng phím).
- Còn dở / lỗi đã biết: bước 2 (IPAM trong panel: gán VLAN cho cổng, gán IP, lấy IP trống, tạo VLAN/subnet tại chỗ) **chờ người
  dùng chốt cách lưu** (xem dưới). Rủi ro ghi lại: trạng thái "Down" tự đặt có thể chồng với trạng thái thật từ giám sát
  (Phase 3); poller Phase 3 phải dùng IP riêng của từng máy, không dùng IP cụm.
- Câu hỏi cho người dùng: IPAM trong panel ghi thẳng vào IPAM (không hoàn tác bằng Ctrl+Z) hay chờ lưu sơ đồ?
- Đề xuất quyết định cần chốt: cách lưu thay đổi IPAM từ panel (ADR mới).
- Task tiếp theo đề xuất: P1-18 bước 2 sau khi chốt.

## 2026-10-17 — Sơ đồ: IP trên thiết bị, trạng thái dây; dữ liệu mẫu CJ Foodville
- Đã làm:
  - Mỗi thiết bị trên sơ đồ hiện **IP quản trị** dưới hostname (bỏ /mask cho gọn, tooltip có đủ); hostname dài **xuống 2 dòng**
    thay vì bị cắt. Thành viên cụm chưa có IP quản trị riêng hiện **IP của cụm** (VIP của cặp HA) ở sơ đồ, danh sách và trang
    thiết bị (query `mgmt_ip` lấy `device_clusters.mgmt_ip` khi thiếu).
  - **Trạng thái thiết kế của dây** trên sơ đồ: Down = nét đỏ + nhãn "✕ DOWN" (hiện cả khi zoom nhỏ), Dự kiến = mờ + nhãn; chọn
    trạng thái ngay trong hộp nối/sửa dây. Trạng thái thật Up/Down từ giám sát SNMP là Phase 3.
  - Script `docs/demo/he-thong/seed-dev-cj.sh` nạp mẫu CJ Foodville (theo `docs/demo`) vào tổ chức CJ trên máy dev **qua API
    với phiên đăng nhập của người dùng** (cookie `ntb_session`): dùng lại danh mục FOODVILLE, 3 site, template FortiGate có sẵn;
    cập nhật VPN_CJIDC / ISR4331 theo Excel (ISR về site HaNoi), thêm 8 thiết bị, cụm HA `CJIDC-HA`, 9 dây, sơ đồ mới
    "Foodville — dữ liệu mẫu" (không đụng sơ đồ "Topology Foodville"). Đã chạy thử trên bản sao cấu trúc ở môi trường riêng.
    Không tự tạo phiên trong DB của người dùng (bị chặn đúng — giả danh tài khoản).
- Test / cách kiểm tra: `make check` pass (Go: `TestClusterMemberShowsClusterMgmtIP`; vitest: IP trên node, dây Down).
- Còn dở / lỗi đã biết: script chỉ nên chạy một lần (lần hai báo trùng dây/sơ đồ).
- Câu hỏi cho người dùng: chạy script với cookie phiên của mình.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-18 Panel thuộc tính.

## 2026-10-17 — P1-17 Nối dây
- Đã làm:
  - **Kéo dây** từ điểm nối ở mép thiết bị (hiện khi rê chuột) sang thiết bị khác, hoặc **chế độ nối** (phím L, nút toolbar, menu
    "Nối dây từ đây") rồi bấm hai thiết bị; Esc hủy.
  - **Hộp nối dây**: loại dây gợi ý theo hai đầu (UPS/PDU → nguồn, trừ khi chọn cổng mạng RJ45 của UPS; modem ↔ Internet → DSL;
    ONT/OLT → quang; hai cầu không dây / AP ↔ nhóm → không dây; cùng cụm → stack; hai cổng SFP → quang; còn lại Ethernet), tự
    gợi ý lại khi chọn cổng cho tới khi người dùng tự chọn loại. Danh sách cổng sắp tự nhiên (Gi1/0/2 trước Gi1/0/10), cổng trống
    cắm được lên đầu, cổng đã có dây ghi "đang nối X", cổng không cắm được bị mờ, không hiện LAG; tính cả dây chưa lưu/đã xóa
    trong editor. Đầu là nhóm đầu cuối, Internet/nhà mạng, hoặc đầu thiết bị của dây nguồn thì không chọn cổng (có giải thích).
  - **Thiết bị chưa lưu có cổng ngay**: thiết bị tạo từ template / nhân bản nhận danh sách cổng của template với id tạm; khi lưu
    backend sinh cổng thật và ánh xạ id tạm (`DiagramChange.portTempIds`, dây dùng id tạm của cổng được map) — có test backend.
  - **Nhấp đúp vào dây** (hoặc menu "Sửa dây") để đổi loại / gán cổng sau (ADR-013).
  - **Dây trên canvas**: đường thẳng nối mép hai thiết bị (không còn cố định đáy → đỉnh), dây song song tự tách, tên cổng rút gọn
    ở hai đầu (GigabitEthernet1/0/1 → Gi1/0/1), ẩn khi zoom < 50 %.
  - **Sửa lỗi P1-16 từ rà soát:** menu dây không còn kéo theo thiết bị đang chọn (và ngược lại); dán thiết bị đang chờ xóa không
    làm nó "sống lại"; dán nhóm đầu cuối hiện đúng tên và dây; thao tác trong lúc đang lưu báo "đang lưu" thay vì báo thành công
    giả; lỗi tra hostname khi nhân bản không bị nuốt; dây logical nối nhóm đầu cuối được phép như ADR-033.
- Test / cách kiểm tra: `make check` pass (Go: `TestDiagramSaveCablesNewDevicePorts`; vitest 230: gợi ý loại dây, sắp cổng, cổng
  bận, nhãn rút gọn, hình học dây, portTempIds; App: L + 2 click → chọn cổng (gồm cổng tạm của thiết bị chưa lưu) → lưu). Chạy
  thật trên Chromium + API: kéo từ điểm nối IDC-FW01 sang IDC-R01 → chọn Gi0/2 → lưu → dây song song tách, nhãn Gi0/2; nhấp đúp
  mở "Sửa dây"; axe không lỗi.
- Còn dở / lỗi đã biết: dây chỉ vẽ thẳng (orthogonal/cong và điểm uốn để sau); kéo lại đầu dây để đổi cổng chưa có (dùng nhấp đúp);
  nhân bản chép cổng theo template, không chép cổng chỉnh tay của thiết bị gốc; thiết bị chưa lưu không có template thì chưa có
  cổng tới khi lưu.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-18 Panel thuộc tính (bước 1: sửa nhanh thiết bị/dây, danh sách cổng).

## 2026-10-17 — P1-16 Thao tác chọn & sửa
- Đã làm:
  - **Sao chép / dán / nhân bản** (Ctrl+C / Ctrl+V / Ctrl+D, menu chuột phải): một quyết định cho cả lần dán — sơ đồ đích chưa có các
    thiết bị → đặt đúng thiết bị trong kho kèm dây có sẵn; đã có (hoặc Ctrl+D) → tạo thiết bị mới chưa lưu, hostname số kế tiếp
    (tra cả kho), trạng thái "dự kiến", chỉ giữ thông tin model + template (không S/N, IP, rack, cụm); dây giữa các bản sao được
    nhân bản (không giữ cable ID/circuit); nhóm đầu cuối không nhân bản; chặn dán dữ liệu tổ chức khác. Clipboard riêng của app
    (dùng chung giữa các tab), không đưa dữ liệu kho ra clipboard hệ thống.
  - **Khóa / mở khóa** (Ctrl+Shift+L, menu): node khóa không kéo được, Delete bỏ qua và báo.
  - **Xóa khỏi kho** (Shift+Delete, menu; Delete trên dây): hộp xác nhận liệt kê mọi dây đi theo (kể cả dây không có trên sơ đồ
    này), các sơ đồ khác đang có thiết bị, cụm còn mấy thành viên, số IP được giải phóng — endpoint mới
    `POST /devices/delete-impact` (chỉ đọc, có test cách ly tổ chức). Xóa khi lưu, hoàn tác được trước đó.
  - **Menu chuột phải** trên node / dây / nền (có phím tắt, điều khiển bằng bàn phím), mở trang thiết bị ở tab mới.
  - **Sửa lỗi từ rà soát (agent chạy song song):** đặt thiết bị từ kho giờ hiện luôn dây sẵn có tới thiết bị trên sơ đồ; sửa trong
    lúc đang lưu bị mất → chờ lưu xong; Ctrl+S hai lần → chỉ một lần lưu; người chỉ xem thấy biểu tượng khóa ở mọi node; dialog
    thiết bị mới báo hostname đã có trong kho; node của thiết bị đã bị xóa khỏi kho không còn hiện "Không xác định" (bỏ khi tải).
    Device trả thêm `templateId` (bản sao sinh lại cổng theo template). Nút chính lúc tắt chuyển xám (dễ thấy ở nền tối).
- Test / cách kiểm tra: `make check` pass (Go: `TestDeviceDeleteImpact`; vitest 223: clipboard/nhân bản/khóa/chờ lưu, App: Ctrl+D,
  menu + khóa, Shift+Delete với danh sách ảnh hưởng, đặt thiết bị kèm dây). Chạy thật trên Chromium + API: nhân bản SW02 → SW03
  "dự kiến"; xóa CORE01 → hộp xác nhận liệt kê 3 dây, sau lưu kho còn 3 dây; axe không lỗi (menu, hộp xác nhận).
- Còn dở / lỗi đã biết: bản sao sinh cổng theo template (không chép cổng đã chỉnh tay của thiết bị gốc) và dây giữa bản sao chưa
  có cổng — làm cùng P1-17 (đề xuất: API tạo thiết bị `cloneOf` chép interface). Xóa thiết bị không tự dọn node trên sơ đồ khác
  (tự bỏ khi sơ đồ đó được mở/lưu).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-17 Nối dây (kèm sinh cổng ngay khi tạo thiết bị / nhân bản).

## 2026-10-17 — P1-31 Mô hình dây & loại thiết bị theo thực tế (ADR-033)
- Đã làm:
  - Người dùng chốt 4 đề xuất của rà soát P1-15; agent kỹ sư mạng rà lại bản nháp ADR-033 trước khi code, tinh chỉnh luật cổng.
  - **Loại dây** mới: ethernet (gồm DAC), fiber (SM/MM, đầu nối LC/SC/MPO/ST, cổng PON), wireless, stack/HA, power, dsl,
    cellular, console, serial, logical. Luật theo từng loại (API): media cổng phải cắm được (vd quang vào RJ45 → lỗi); radio,
    4G/5G và cổng PON nối được nhiều dây; dây nguồn phải có đầu UPS/PDU và đầu thiết bị không chọn cổng; stack khác cụm → lỗi;
    logical được gắn cổng WAN vật lý (VPN FortiGate), không dùng LAG; LAG = vẽ từng dây thành viên.
  - **Dịch vụ WAN** (Internet FTTH / Internet trực tiếp / MPLS / kênh thuê riêng / Metro / 4G-5G / khác) thay cho "MPLS là kiểu nét".
  - **Loại thiết bị** mới: Internet/nhà mạng (`provider_cloud` — luôn "bên ngoài", được trùng tên, không chọn cổng), OLT, cầu
    không dây, console server; media cổng PON, xDSL, Cellular. **Icon** riêng cho router (trước trùng switch L2) và các loại
    NVR, ONT, OLT, UPS, PDU, PBX, kiểm soát ra vào, hội nghị truyền hình, cầu không dây, console server.
  - **Hostname tự đặt**: ô trống, dưới ô có gợi ý theo đường dẫn mã site (bấm để dùng); kiểm tra đúng luật kho, `_`/`.` và tên
    Windows dài chỉ cảnh báo.
  - Migration 000021 (thử up/down/up có dữ liệu): DAC → ethernet, SM/MM từ medium, MPLS → service. Form dây thêm loại quang, đầu
    nối, dịch vụ WAN; kiểu nét cho 4 loại dây mới; SRS §6.2, ADR-033, GLOSSARY và trang Thuật ngữ cập nhật.
- Test / cách kiểm tra: `make check` pass (Go: `TestLinkKindRules` — media, nhiều dây trên radio/PON, nguồn, stack khác cụm,
  provider cloud; vitest 210). Ảnh thư viện với icon mới trên Chromium.
- Còn dở / lỗi đã biết: `schema/ntb.schema.json` (định dạng xuất/nhập từ prototype Phase 0) còn enum cũ — làm lại khi tới task
  nhập/xuất. Cảnh báo SM–MM/đầu nối/tốc độ lệch… để P1-20. Dây logical cũ nối interface LAG (nếu có) cần vẽ lại.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-16 Thao tác chọn & sửa (xóa khỏi kho có hộp xác nhận).

## 2026-10-17 — P1-15 Thư viện & thêm nhanh (+ sửa lỗi P1-14 từ rà soát)
- Đã làm:
  - **Thư viện nổi** bên trái màn vẽ (phím B, nút trên toolbar): tìm kiếm không dấu; tab "Thêm mới" = template của tổ chức +
    34 loại thiết bị chia 7 nhóm (Internet & WAN, Switch & Wi-Fi, Bảo mật, Máy chủ, Người dùng & văn phòng, Camera/tòa nhà/IoT,
    Nguồn điện) — mỗi loại có mô tả 1 dòng cho người không chuyên; tab "Trong kho" = thiết bị chưa có trên sơ đồ (tìm trên
    server). Kéo thả vào canvas (đặt đúng chỗ thả) hoặc bấm (đặt giữa màn hình).
  - **Thêm nhanh `/`**: tìm thiết bị trong kho → template → loại; Enter để đặt.
  - **Thiết bị mới**: dialog chỉ hỏi loại, template (tùy chọn), site, hostname; tạo như thay đổi chờ lưu (command, hoàn tác
    được); khi lưu backend điền hãng/model và **sinh cổng theo template** (đã kiểm tra thật: FortiGate 100F → 18 cổng).
    Site mặc định: site duy nhất của các thiết bị trên sơ đồ, nếu không thì site vừa dùng, nếu không thì bắt chọn (không tự lấy
    site đầu danh sách). Hostname gợi ý `<mã site bỏ mã tổ chức>-<TIỀN TỐ><NN>` (vd `AGRI-BD01-FW01`), số = lớn nhất đang
    dùng + 1 (tra cả kho); kiểm tra chữ/số/“-”, ≤ 63; cảnh báo > 15 ký tự với máy chủ/PC (Windows cắt tên).
  - Nhóm loại thiết bị và mô tả dùng chung cho form thiết bị, trang template và thư viện (`DEVICE_TYPE_GROUPS`, `typeInfo`).
    Nhãn "ONT/OLT" → "ONT (quang nhà mạng)"; hướng dẫn hostname bỏ chữ "đối tác"; glossary cập nhật Hostname, ONT/Modem.
  - **Sửa lỗi P1-14** (agent rà soát chạy song song): nháp ghi ngay khi rời màn vẽ (trước đây rời trong 0,6 s là mất);
    phím Delete / Ctrl+A chỉ tác động khi canvas có focus (không còn xóa node khi đang ở thư viện/menu); Delete bỏ qua node đã
    khóa, Shift+Delete không còn là "gỡ" (dành cho xóa khỏi kho ở P1-16); trackpad: cuộn = di chuyển, Ctrl/chụm = phóng;
    hoàn tác về đúng bản đã lưu → "Đã lưu"; vùng chọn bỏ node không còn; vị trí nhìn nhớ theo từng người (trình duyệt) và
    reset khi tải lại sau xung đột; viền nét đứt trả lại cho thiết bị không quản lý (thiết bị chưa lưu dùng nhãn "chưa lưu");
    kéo nhiều node không quét danh sách mỗi node; tooltip hiện ⌘ trên macOS; "vừa màn hình" chừa chỗ thư viện.
- Test / cách kiểm tra: `make check` pass (vitest 210). Chạy thật trên môi trường riêng (Chromium + API + Postgres): kéo template
  vào canvas → chọn site → hostname gợi ý → Ctrl+S → API trả thiết bị có model + 18 cổng; axe WCAG A/AA không lỗi (màn vẽ và
  dialog); ảnh sáng/tối.
- Còn dở / lỗi đã biết: chưa chặn điều hướng trong app khi có thay đổi (router hiện không phải data router nên không dùng
  `useBlocker`; đã bù bằng ghi nháp ngay). Cổng theo template chỉ có sau khi lưu — P1-17 (chọn cổng khi nối dây) cần sinh
  cổng ngay lúc tạo. Nút chính ở trạng thái tắt khó phân biệt ở nền tối (component Button chung). Prototype `/editor` vẫn còn.
- Câu hỏi cho người dùng: xem "Đề xuất" dưới — các điểm mô hình dữ liệu, chưa làm khi chưa chốt.
- Đề xuất quyết định cần chốt (từ rà soát nghiệp vụ):
  1. Loại thiết bị thêm: `wireless_bridge` (cầu Wi-Fi điểm–điểm giữa các nhà xưởng), `console_server`, nút "Internet/nhà mạng"
     (đám mây ISP — hình vẽ hay dùng nhất), tùy chọn `olt`.
  2. Loại dây: DAC là cáp **đồng** (đang xếp vào Fiber), LAG là bó dây vật lý (không phải logical), MPLS là dịch vụ WAN (thuộc
     tính đường truyền hơn là kiểu nét); thiếu dây nguồn (UPS/PDU → thiết bị), stacking/HA heartbeat, DSL/coax, 4G/5G.
     Fiber nên ghi đầu nối (LC/SC) và SM/MM để bắt lỗi lệch.
  3. Quy ước hostname thành cài đặt của tổ chức (mẫu + tiền tố sửa được), hiện đang cố định trong code.
  4. Xóa khỏi kho: thay Shift+Delete bằng lệnh trong menu có xác nhận gõ tên (an toàn hơn, Mac không có phím Delete thật).
- Task tiếp theo đề xuất: P1-16 Thao tác chọn & sửa (sau khi chốt mục 4), rồi P1-17 Nối dây (sau khi chốt mục 2).

## 2026-10-17 — P1-14 Canvas & toolbar nổi
- Đã làm:
  - **Màn vẽ** (`/o/:orgId/diagrams/:id`) thay danh sách tạm của P1-13 bằng canvas React Flow chiếm toàn bộ vùng nội dung,
    đọc/ghi qua document store (mọi thay đổi vẫn là command có undo/redo; kéo một lần = một bước hoàn tác; node khóa không
    kéo được). Vùng chọn và vị trí nhìn (viewport) là trạng thái editor, không vào lịch sử; viewport được lưu cùng sơ đồ.
  - **Node** chỉ nhận id và tự đọc thẻ của mình từ store (đổi một thiết bị không vẽ lại các node khác); hiện icon, hostname, loại
    (ẩn dòng phụ khi zoom < 50 %), viền nét đứt cho thiết bị chưa lưu. **Dây** nét theo loại (quang dày, logical/wireless
    đứt, console chấm, serial gạch-chấm) — chọn cổng/kéo dây ở P1-17.
  - **Toolbar nổi** phía trên: về danh sách, tên + lớp + trạng thái lưu, hoàn tác/làm lại, thêm thiết bị từ kho (tạm, thư viện ở
    P1-15), thu nhỏ / % (bấm về 100 %) / phóng to / vừa màn hình, bắt lưới + cỡ lưới 10/20/40, minimap, gợi ý, phím tắt, Lưu.
    Mọi nút có tooltip "tên + phím tắt" và `aria-keyshortcuts`.
  - **Phím tắt** (SRS §6.4, phần đã có): Ctrl+Z / Ctrl+Shift+Z, Ctrl+S, Shift+1, + / −, Shift+0, Ctrl+A, Esc, Delete (chỉ gỡ khỏi
    sơ đồ), Space+kéo / chuột giữa để di chuyển, kéo nền để khoanh chọn, `?` mở bảng phím tắt. Danh sách phím ở một chỗ
    (`editor/workspace/shortcuts.ts`) để các task sau bổ sung.
  - **Menu trái tự thu gọn** khi vào màn vẽ, mở lại khi rời đi. **Gợi ý lần đầu** (thẻ góc dưới) tắt được, bật lại từ toolbar;
    tùy chọn lưới/minimap/gợi ý lưu theo trình duyệt.
  - Dọn chữ cũ còn nhắc "đơn vị"/"phạm vi" ở sơ đồ và cụm.
- Test / cách kiểm tra: `make check` pass (vitest 200 test: chuyển doc → React Flow, viewport/selection ngoài lịch sử, map phím;
  App test: thêm từ kho trên canvas → undo/redo → Ctrl+S, Ctrl+A + Delete chỉ gỡ khỏi sơ đồ, `?`, ẩn gợi ý, viewer không sửa
  được). Chụp màn hình Chromium sáng/tối trên môi trường riêng; axe WCAG A/AA không lỗi.
- Còn dở / lỗi đã biết: dây nối tạm gắn cạnh trên/dưới của node (đường đi chưa đẹp với node ngang hàng) — P1-17 làm cổng và
  đường đi. Thêm thiết bị tạm qua nút + (thư viện kéo thả ở P1-15). Màn `/editor` prototype Phase 0 vẫn còn, gỡ khi P1-15..20
  chuyển xong palette, hộp thoại nối dây và validation.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-15 Thư viện & thêm nhanh.

## 2026-10-17 — P1-27 Cây Danh mục & mã site tự sinh + P1-29 Gỡ Đơn vị (ADR-032)
- Đã làm:
  - **Migration 000020:** bảng `categories` (cây cha–con tự do, tối đa 8 cấp, mã `A-Z0-9` duy nhất giữa anh em),
    `organizations.code`, `sites.category_id` (null = gắn thẳng tổ chức) + `local_code`; `sites.code` = mã đầy đủ
    `<mã tổ chức>-<mã các danh mục>-<mã riêng>`. Chuyển dữ liệu: đối tác → danh mục, đơn vị → danh mục con (trừ `MAIN` duy nhất),
    site `SHARED-…` → gắn tổ chức. Bỏ `business_unit_id` ở thiết bị/cụm/nhóm/site, bỏ scope sơ đồ (sơ đồ thuộc tổ chức, tên duy
    nhất), xóa bảng partners/business_units; view `ipam_addresses` dựng lại. Hàm SQL `category_path`, `category_subtree`.
  - **API:** `/categories` CRUD, `/categories/{id}/preview` (site nào đổi mã), `/code-preview?code=` (đổi mã tổ chức); sửa danh
    mục/tổ chức làm đổi mã site phải gửi `confirmSiteCodes: true`, nếu không trả 409 kèm danh sách; đổi mã ghi audit `site.recode`.
    Lọc site/thiết bị theo nhánh (`categoryId`, gồm cả danh mục con); gợi ý mã site theo danh mục.
  - **Frontend:** màn "Danh mục & Sites" (cây bên trái, site của nhánh bên phải), dialog danh mục có xem trước → xác nhận đổi mã,
    form site chọn danh mục + mã riêng + xem trước mã đầy đủ; sửa tổ chức có mã; bộ chọn topbar chọn nhánh danh mục; bỏ hết
    trang/trường đối tác & đơn vị; cột "Danh mục" ở danh sách thiết bị/site; tạo sơ đồ chỉ cần tên + lớp; i18n, hướng dẫn, glossary.
- Test / cách kiểm tra: `make check` pass (Go: category_test.go — cách ly tổ chức, cây nhiều cấp, đổi mã có/không xác nhận,
  chuyển nhánh, xóa; vitest 193 test). Migration up/down/up đã chạy trên DB thử có dữ liệu mẫu.
  Trên máy anh: `make migrate-up` (000019, 000020) rồi khởi động lại `make dev-api`.
- Còn dở / lỗi đã biết: migration down của 000020 mất dữ liệu (không khôi phục đối tác/đơn vị). Ảnh chụp màn hình/axe trên môi
  trường riêng chưa chạy lại cho màn mới.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-14 Canvas editor.

## 2026-10-16 — P1-28 Quyền chỉ theo tổ chức (ADR-032)
- Đã làm:
  - **Migration 000019:** xóa `partner_members`, `business_unit_members`, `resource_shares`; vai trò `member` → `viewer`; ràng buộc
    vai trò còn owner/admin/editor/viewer.
  - **Backend:** bỏ bộ lọc hiển thị theo quyền khỏi mọi query (thiết bị, cụm, nhóm, IPAM, site, sơ đồ); mức quyền = vai trò tổ chức
    (`Membership.Level`); bỏ API giao quyền đối tác/đơn vị và chia sẻ site (OpenAPI + handler); `MembershipInfo` chỉ còn vai trò +
    quyền bổ sung. Tạm giữ hàm `UnitLevel/PartnerLevel` (trả mức tổ chức) tới khi bỏ đơn vị ở P1-29.
  - **Frontend:** bỏ panel giao quyền ở trang đối tác/đơn vị, tab chia sẻ ở trang site, vai trò "member" ở trang Thành viên;
    `useOrgAccess` chỉ dựa vào vai trò; Ctrl+K "Sơ đồ" mở danh sách sơ đồ mới; bỏ thuật ngữ "chia sẻ".
- Test / cách kiểm tra: test phân quyền viết lại theo vai trò tổ chức (viewer đọc được mọi site, mọi thao tác ghi 403; editor sửa
  toàn tổ chức; sửa hàng loạt vẫn "tất cả hoặc không"); migration down/up chạy; Go + Vitest 194 pass; `make check` pass.
  **Cần chạy `make migrate-up` (000019) rồi khởi động lại `make dev-api`.**
- Còn dở / lỗi đã biết: dữ liệu và màn hình vẫn dùng đối tác/đơn vị cho tới P1-27/P1-29 (làm cùng một lượt tiếp theo).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-27 + P1-29** Cây Danh mục thay đối tác/đơn vị ở mọi nơi, mã site tự sinh.

## 2026-10-16 — Chốt lại phân cấp & quyền (ADR-032), chia lại task
- Đã làm (chỉ tài liệu, chưa sửa code): sau trao đổi với người dùng, ghi **ADR-032** thay ADR-026/029/030/031 và một phần
  ADR-025/028:
  - Cây **Danh mục** nhiều cấp (một bảng cha–con, tên + mã) thay cho Đối tác → Đơn vị; tổ chức không cần danh mục vẫn dùng được
    ("Công ty → Site"). Site gắn vào bất kỳ danh mục nào hoặc thẳng vào tổ chức; bỏ "site dùng chung" (dùng chung là thiết bị).
  - Mã site tự sinh theo đường đi (`CJ-CJFEED-HCM`); đổi mã / chuyển nhánh → xem trước danh sách site đổi mã và xác nhận.
  - Quyền **chỉ theo vai trò trong tổ chức**: mọi thành viên thấy toàn bộ tổ chức; bỏ giao quyền đối tác/đơn vị và chia sẻ.
  - Sơ đồ thuộc tổ chức; **khung nhóm** gắn site/location trên sơ đồ (thiết bị mới thả vào khung nhận site; lệch site → cảnh báo).
  - Cập nhật SRS §1, §2, §3, §4.1, §6.1, §10, §12, mô hình dữ liệu, checklist; CLAUDE.md.
  - PLAN: thêm **P1-27** (cây danh mục + mã site), **P1-28** (quyền chỉ theo tổ chức), **P1-29** (gỡ đơn vị khỏi thiết bị/cụm/nhóm/
    sơ đồ), làm trước P1-14; P1-19 thêm khung nhóm; P1-20 thêm cảnh báo lệch site; P1-21/P1-25 đổi đơn vị → danh mục.
- Test / cách kiểm tra: không có thay đổi code.
- Còn dở / lỗi đã biết: code hiện tại vẫn theo ADR-031 cho tới khi xong P1-27..P1-29.
- Câu hỏi cho người dùng: không. *(Đã chốt thêm: giữ menu IPAM để tra cứu nhanh; panel thuộc tính trên sơ đồ cũng tạo/gán VLAN, subnet, IP — ghi vào P1-18 và ADR-014.)*
- Đề xuất quyết định cần chốt: như trên.
- Task tiếp theo đề xuất: **P1-27** Cây Danh mục & mã site tự sinh.

## 2026-10-16 — P1-13 Diagram API & store
- Đã làm:
  - **Migration 000018:** `diagrams` — phạm vi tổ chức / đơn vị / site (ADR-028), lớp (vật lý, L2, L3, tổng quan), `view` JSONB
    (node → thiết bị / nhóm / site / sơ đồ con, cạnh → link + đường đi, chú thích, viewport, mẫu nhãn; tối đa 4 MB), version.
  - **API:** CRUD sơ đồ; `GET` trả view + thiết bị / nhóm / link đang hiện + `hiddenRefs`; **`POST …/save`** gửi một lần view
    và các thay đổi kho (tạo/sửa/xóa thiết bị, tạo/sửa/xóa link; temp id → id thật trả về `idMap`) trong **một transaction**,
    khóa lạc quan (409 khi người khác đã lưu). Mọi quy tắc của kho áp dụng y như khi sửa ngoài sơ đồ (hostname, cổng một dây…);
    một thay đổi lỗi → không gì được lưu, thông báo nói rõ "Thay đổi n: …". Audit `diagram.*` (save ghi số node/cạnh/thay đổi).
    Tách `writeLink`, `deleteDeviceTx`, `inputFromUpdate` để dùng chung transaction.
  - **Store editor mới** `frontend/src/editor/doc/`: Zustand + Immer, mọi thay đổi qua command (thêm/di chuyển/gỡ node, tạo/sửa/
    xóa thiết bị, tạo/sửa/xóa link), undo/redo 200 bước, kéo liên tục gộp một bước; thay đổi kho chờ gửi nằm trong tài liệu nên
    undo hủy luôn thay đổi; link kho giữa các node luôn được vẽ. **Nháp chưa gửi** lưu IndexedDB (Dexie — có trong Stack, mới
    cài) 0,6 s sau mỗi thay đổi; mở lại sơ đồ thì hỏi khôi phục / bỏ (báo nếu nháp dựa trên bản cũ).
  - **Giao diện:** menu **Sơ đồ** → danh sách (lọc phạm vi / lớp, tạo, xóa); trang mở sơ đồ: trạng thái lưu, Hoàn tác / Làm lại /
    Lưu (Ctrl+Z, Ctrl+Shift+Z, Ctrl+S), banner nháp, banner xung đột (tải bản mới), cảnh báo khi đóng tab còn thay đổi, chế độ chỉ
    xem. Màn vẽ là bước P1-14 — tạm thời trang liệt kê đối tượng trên sơ đồ, thêm thiết bị từ kho, gỡ khỏi sơ đồ.
    Prototype editor cũ (`/editor`, mô hình file) vẫn giữ để P1-14 chuyển canvas sang store mới.
- Test / cách kiểm tra: Go 3 test mới với DB thật (cách ly tổ chức; lưu kèm tạo thiết bị + link bằng temp id; 409 bản cũ; lưu
  "tất cả hoặc không"; ref sai; xóa khỏi kho kéo link; quyền theo phạm vi + hidden ref). 4/5 mutation bị bắt (mutation còn lại là
  kiểm tra version đầu — đã có lớp thứ hai trong câu UPDATE). Vitest 198 pass (11 test store: undo hủy thay đổi, gộp kéo, ≥100
  bước, xóa nháp thiết bị kéo link nháp, nháp round-trip…; 4 test UI). Ảnh chụp + axe: 0 lỗi. `make check` pass.
  **Cần chạy `make migrate-up` (000018) rồi khởi động lại `make dev-api`.**
- Còn dở / lỗi đã biết: lịch sử undo bắt đầu lại sau mỗi lần lưu; sơ đồ phạm vi **đối tác** (ADR-031) chưa có — xem đề xuất.
- Câu hỏi cho người dùng: có cần sơ đồ tổng quan theo **đối tác** (vd tổng quan cả AGRI gồm nhiều đơn vị) không? ADR-028 chỉ ghi
  tổ chức / đơn vị / site; thêm phạm vi `partner` khá nhỏ (một cột + quyền theo đối tác).
- Đề xuất quyết định cần chốt: như trên.
- Task tiếp theo đề xuất: **P1-14** Canvas & toolbar nổi (chuyển canvas React Flow sang store mới).

## 2026-10-16 — P1-12 Link API
- Đã làm:
  - **Migration 000017:** bảng `links` — mỗi đầu là thiết bị hoặc nhóm đầu cuối, cổng để trống được (vẽ mức logic, gán sau, ADR-013);
    loại ethernet/fiber/wireless/serial/logical/console, biến thể cáp, tốc độ, chiều dài, cable ID, trạng thái thiết kế
    (Đang chạy / Dự kiến / Đứt), thông tin WAN (nhà mạng, circuit ID, băng thông — sẽ nối module Nhà cung cấp ở Phase 2).
  - **API** `GET/POST /links` (lọc theo một đầu hoặc site), `PATCH/DELETE /links/{id}`. Quy tắc (SRS §7 mức Error):
    **một cổng vật lý chỉ một dây** (kiểm dưới khóa theo cổng); **dây vật lý không vào interface ảo**; **logical (VPN/GRE/LAG)
    không chiếm cổng vật lý**; cổng phải thuộc đúng thiết bị; nhóm đầu cuối không có cổng; ít nhất một đầu là thiết bị; không nối
    một cổng với chính nó. Quyền: thấy link khi thấy **cả hai đầu**; sửa khi có quyền sửa ít nhất một đầu. Xóa thiết bị/nhóm thì
    xóa link theo (có audit), xóa interface thì link còn nhưng thành "chưa gán cổng". Audit `link.*`.
  - **Tách thành viên nhóm → thiết bị** (P1-11) giờ tạo **link thật** `eth0` ↔ cổng switch nếu cổng còn trống (không còn ghi chú).
  - **Giao diện:** tab **Kết nối** ở trang thiết bị (thay chỗ "sắp có") và mục Kết nối ở trang nhóm đầu cuối: bảng cổng ↔ thiết
    bị/nhóm bên kia (link, mã site nếu khác site), loại + biến thể + tốc độ, trạng thái (icon + chữ), cable ID; form chọn loại →
    chỉ liệt kê cổng hợp loại, cổng đã có dây bị làm mờ; tìm thiết bị đầu kia (cùng site lên trước); gợi ý biến thể cáp theo loại;
    phần "Thông tin WAN / nhà mạng" thu gọn. Hướng dẫn + thuật ngữ mới (`link-kind`; GLOSSARY.md: link vật lý/logical, Cable ID, DAC).
- Test / cách kiểm tra: Go 3 test mới với DB thật (cách ly tổ chức, quy tắc cổng/loại/chiếm cổng/di chuyển/xóa kèm, phân quyền nửa
  thấy nửa không); 7 mutation đều bị bắt; test tách thành viên kiểm link thật. Vitest 183 pass (thêm: tab Kết nối — SVI bị ẩn,
  cổng đã có dây bị khóa, tạo link). Ảnh chụp + axe sáng/tối: 0 lỗi. `make check` pass.
  **Cần chạy `make migrate-up` (000017) rồi khởi động lại `make dev-api`.**
- Còn dở / lỗi đã biết: cảnh báo mức Warning (RJ45 ↔ SFP, hai đầu L3 khác subnet…) làm ở validation P1-20; link chưa hiện trong tab
  Interfaces (cột "nối tới") — có thể thêm khi làm editor.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-13** Diagram API & store (bắt đầu editor sơ đồ).

## 2026-10-16 — P1-11 Nhóm thiết bị đầu cuối
- Đã làm:
  - **Migration 000016:** `endpoint_groups` (loại = loại thiết bị đầu cuối, tên không trùng trong site, site + đơn vị sở hữu như
    thiết bị, dải IP liên kết, số lượng dự kiến, ghi chú) và `endpoint_members` (tên, IP, MAC, cổng switch, ghi chú; tên/IP không
    trùng trong nhóm). View `ipam_addresses` thêm IP thành viên (VRF lấy từ subnet của dải) → tính "đang dùng", "IP trống" bỏ qua,
    Tra IP thấy thành viên.
  - **API:** CRUD nhóm + thành viên, `POST …/members/{id}/promote` (tách thành thiết bị). Quy tắc: dải phải thuộc subnet cùng site
    (hoặc toàn tổ chức); IP thành viên nằm trong dải của nhóm; đổi dải không được làm thành viên rơi ra ngoài; cổng switch phải là
    **cổng vật lý** của thiết bị cùng site mà người dùng thấy được; "tổng" = số dự kiến, không có thì = số địa chỉ của dải. Không xóa
    được site/đơn vị còn nhóm. Audit `endpoint_group.*`, `endpoint_member.*` (kể cả `promote`).
  - **Tách thành thiết bị** (một transaction): tạo thiết bị cùng loại/site/đơn vị (hostname mặc định = tên thành viên, đổi được),
    cổng `eth0` mang MAC + IP (prefix theo subnet, VRF của subnet) và làm interface quản trị; cổng switch đang cắm ghi vào ghi chú
    (link thật làm ở P1-12); thành viên rời nhóm. Thân `saveDevice` tách thành `writeDevice` để dùng chung transaction.
  - **Giao diện:** trang Thiết bị có tab **Nhóm đầu cuối** (lọc site/loại, thanh "đã dùng/tổng"); form nhóm chọn Site → Subnet →
    Dải IP; trang nhóm: thông tin dải/subnet (link sang IPAM), bảng thành viên (IP, MAC, cổng switch có link), thêm/sửa/xóa, nút
    tách thành thiết bị. Form thành viên chọn thiết bị mạng cùng site → cổng vật lý. IPAM hiện dòng "Thành viên nhóm …" có link về
    nhóm. Hướng dẫn trên form + thuật ngữ mới (`endpoint-group`; GLOSSARY.md mục 4b).
  - ADR-014 ghi chú: dải IP dùng VLAN của subnet (người dùng đồng ý).
- Test / cách kiểm tra: Go 4 test mới với DB thật (cách ly tổ chức mọi endpoint, quy tắc nhóm/thành viên/cổng, tích hợp IPAM, tách
  thành thiết bị kể cả trường hợp bị từ chối, phân quyền); 7 mutation đều bị bắt. Vitest 182 pass (thêm: tab nhóm + tạo nhóm theo
  dải, thêm thành viên chỉ cổng vật lý + tách thành thiết bị, viewer không có nút). Ảnh chụp 6 màn + axe sáng/tối: 0 lỗi.
  `make check` pass. **Cần chạy `make migrate-up` (000016) rồi khởi động lại `make dev-api`.**
- Còn dở / lỗi đã biết: cổng switch chưa phải "link" (P1-12 sẽ chuyển thành link thật, kể cả khi tách); badge "đã dùng/tổng" trên
  sơ đồ làm cùng editor.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-12** Link API.

## 2026-10-16 — P1-10 IPAM cơ bản
- Đã làm:
  - **Migration 000015:** `vlans` (số 1–4094, tên, màu, site hoặc toàn tổ chức; không trùng số trong một phạm vi), `subnets`
    (CIDR, VRF, gateway, site, VLAN, mô tả; không trùng CIDR trong một VRF, cho phép lồng nhau vd /16 chứa /24), `ip_ranges`
    (từ–đến, loại DHCP / IP tĩnh / dành riêng, mục đích), view **`ipam_addresses`** = IP của interface thiết bị **+ IP quản trị
    cụm** (IP chung của cặp HA/stack không nằm trên interface nào nhưng không được cấp lại).
  - **API** (`api/openapi.yaml`): VLAN CRUD, subnet CRUD + chi tiết (dải, IP đang dùng, số IP bị ẩn), dải IP CRUD,
    `GET …/subnets/{id}/next-free`, `GET …/ipam/lookup?ip=`. Quy tắc: gateway phải là địa chỉ dùng được trong subnet (không phải
    địa chỉ mạng/broadcast; /31 dùng cả 2 địa chỉ), VLAN của subnet phải cùng site hoặc toàn tổ chức, không dời VLAN sang site
    khác khi subnet site khác đang dùng, dải nằm trong địa chỉ dùng được và không chồng nhau, thu nhỏ subnet không được làm dải
    rơi ra ngoài, optimistic lock + audit (`vlan.*`, `subnet.*`, `ip_range.*`).
  - **Quyền:** theo site (ADR-031); VLAN/subnet "toàn tổ chức" chỉ vai trò cấp tổ chức thấy/sửa. **Mức sử dụng và "IP trống kế
    tiếp" tính trên mọi thiết bị** (cùng VRF) để không cấp trùng, nhưng danh sách IP chỉ hiện thiết bị người xem được thấy — phần
    còn lại hiện "N IP khác đang được thiết bị ngoài phạm vi bạn được xem sử dụng" (không lộ hostname).
  - **"IP trống kế tiếp"** bỏ qua gateway, IP đang dùng, IP cụm, dải DHCP và dải dành riêng; IPv6 quét tối đa 65.536 địa chỉ đầu.
  - **Giao diện:** menu **IPAM** (icon ⌗ theo DESIGN.md §6): ô **Tra IP** (thuộc subnet nào, đang gán cho thiết bị/cụm nào),
    tab Subnet (thanh sử dụng, ≥75% vàng, ≥90% đỏ + chữ "Gần đầy"/"Đầy"; vài IP trong /24 hiện "<1%" chứ không "0%") và tab
    VLAN (màu dùng chung cho sơ đồ). Trang subnet: nút "Tìm IP trống" (copy được), bảng dải IP, bảng IP đang dùng (link thiết bị;
    dòng "IP quản trị cụm"). Form subnet có **xem trước trực tiếp** "Mạng … · dùng được … – … (254 địa chỉ) · mặt nạ …".
    Form IP của thiết bị có **"Lấy IP trống từ subnet"** (subnet của site thiết bị + toàn tổ chức) → tự điền IP và VRF.
  - Hướng dẫn trên form cho mọi trường (hint/guide/(?)); thuật ngữ mới: IPAM, Dải IP, DHCP, IP trống kế tiếp, IP quản trị cụm
    (`glossary.ts` + `docs/GLOSSARY.md`).
- Test / cách kiểm tra: Go 5 test mới với DB thật (cách ly tổ chức cho mọi endpoint, quy tắc VLAN/subnet/dải, mức sử dụng, IP
  trống, IP cụm, tra cứu, phân quyền theo đơn vị/IP bị ẩn); 10 mutation trên các quy tắc chính đều bị test bắt. Vitest 179 pass
  (thêm: phép tính subnet, trang IPAM + tra IP, tạo subnet có xem trước và VLAN lọc theo site, trang subnet + thêm dải, viewer
  không có nút sửa, lấy IP trống trong form IP thiết bị). Ảnh chụp 8 màn × sáng/tối + axe: 0 lỗi. `make check` pass.
  **Cần chạy `make migrate-up` (000015) rồi khởi động lại `make dev-api`.**
- Còn dở / lỗi đã biết:
  - IP quản trị cụm coi như VRF mặc định (cụm chưa có trường VRF).
  - "Bảng IP plan đặt lên sơ đồ" và "switch hiển thị dải/VLAN nó phục vụ" (SRS §5) làm cùng editor (P1-13+) và link (P1-12).
  - IP thành viên nhóm đầu cuối sẽ được thêm vào `ipam_addresses` ở P1-11 (đã ghi vào PLAN).
- Câu hỏi cho người dùng: ADR-014 ghi dải IP có trường **VLAN** riêng. Về mạng, một subnet chạy trên đúng một VLAN nên mọi dải
  trong subnet thuộc VLAN của subnet — hiện tại dải **dùng VLAN của subnet**, không có trường riêng (tránh dữ liệu mâu thuẫn).
  Đồng ý thì ghi chú vào ADR-014.
- Đề xuất quyết định cần chốt: như câu hỏi trên.
- Task tiếp theo đề xuất: **P1-11** Nhóm thiết bị đầu cuối.

## 2026-10-16 — Hướng dẫn trên form: gợi ý, nút (?), trang Thuật ngữ (DESIGN.md §4a)
- Đã làm (người dùng đồng ý đề xuất):
  - **3 tầng hướng dẫn** trong `FormField`: `hint` (quy tắc bắt buộc, luôn hiện), `guide` (giải thích bằng lời thường, ẩn được),
    `help` (nút (?) mở giải thích + ví dụ + link sang trang Thuật ngữ). Component `FieldHelp` cho ô ngoài `FormField`.
  - **Tùy chọn "Hiện hướng dẫn trên form"** trong menu tài khoản (lưu theo trình duyệt); tắt thì ẩn `guide`, nút (?) vẫn còn.
  - **Trang Thuật ngữ mạng** `/o/:orgId/glossary` (menu tài khoản): ~45 thuật ngữ song ngữ, chia nhóm, tìm kiếm, mở đúng mục từ
    nút (?). Dữ liệu `frontend/src/help/glossary.ts`; `docs/GLOSSARY.md` là bản đọc.
  - **Rà mọi form hiện có:** thiết bị (nhận dạng, vị trí, rack/U, cụm, vận hành, ngày hỗ trợ, interface quản trị, poll, template),
    interface, IP, cụm, thêm vào cụm, sửa hàng loạt, template, trường tùy biến, site, rack, đối tác, đơn vị, chia sẻ, cấp quyền.
  - **Quy tắc cho phần sau:** DESIGN.md §4a + CLAUDE.md — mọi form/panel mới phải có hướng dẫn; màn vẽ (P1-14/P1-15) có tooltip
    toolbar, mô tả từng mục thư viện, gợi ý lần đầu mở editor.
- Test / cách kiểm tra: Vitest 170 pass (thêm: (?) mở đúng thuật ngữ + link, tắt hướng dẫn thì ẩn guide nhưng còn (?); trang
  Thuật ngữ tìm kiếm); 2 mutation đều bị bắt; ảnh chụp + axe 4 trang × sáng/tối (kể cả popover đang mở): 0 lỗi; `make check` pass.
- Còn dở / lỗi đã biết: tùy chọn lưu theo trình duyệt (chưa theo tài khoản — làm cùng trang hồ sơ).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-10** IPAM cơ bản.

## 2026-10-16 — Rà soát nghiệp vụ mạng: tên cổng stack, MAC, VLAN tag, thuật ngữ
- Đã làm (người dùng chọn cả 4 mục):
  - **Tên cổng stack:** mẫu tên cổng của template có thêm `{m}` = số thứ tự thành viên stack (1 nếu đứng lẻ), vd `Gi{m}/0/{n}`
    → thành viên 2 có `Gi2/0/1…`. Áp dụng khi tạo thiết bị từ template và khi "Áp template"; các mẫu điền nhanh Cisco/Aruba đã
    dùng `{m}`.
  - **Migration 000014:** interface có **MAC** (nhập kiểu nào cũng được, lưu `aa:bb:cc:dd:ee:ff`; tìm thiết bị theo MAC ở danh
    sách) và **VLAN tag 802.1Q** cho sub-interface (chỉ sub-interface).
  - **Gợi ý trên form:** chú thích ngắn bằng lời thường cho loại interface, mode, access/native/allowed VLAN, LAG, MAC, VLAN tag,
    CIDR, VRF, vai trò IP, kiểu cụm.
  - **`docs/GLOSSARY.md`:** bảng thuật ngữ tiếng Việt (thiết bị, cổng, VLAN, IP, cụm, loại thiết bị) — CLAUDE.md trỏ tới.
  - **PLAN P1-20:** thêm các rule cảnh báo nghiệp vụ mạng (IP trùng theo VRF, IP mạng/broadcast, VLAN sai mode, LAG khác tốc độ,
    cụm khác model/firmware).
- Test / cách kiểm tra: Go — stack thành viên 1/2 + thiết bị lẻ sinh đúng `Gi1/0/1` / `Gi2/0/1` / `Gi1/0/1`; MAC kiểu Cisco
  được chuẩn hóa và tìm được; VLAN tag trên cổng vật lý / ngoài 1–4094 → 400; 3 mutation đều bị bắt. Vitest 168 pass (thêm test
  sub-interface + gợi ý). `make check` pass. Dev DB: `make migrate-up` (000014).
- Còn dở / lỗi đã biết: thiết bị đã vào stack mà cổng đã sinh trước theo `Gi1/…` thì cần xóa/sửa tay (áp lại template chỉ thêm
  cổng còn thiếu).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-10** IPAM cơ bản.

## 2026-10-16 — Quy định loại thiết bị cho cụm (ADR-027)
- Đã làm (người dùng chốt phương án đề xuất): kiểu cụm chỉ nhận loại thiết bị phù hợp (HA: firewall/router/VPN/LB/WLC/WAF/proxy/
  IDS-IPS/SD-WAN/server/NAS; Stack: switch L2/L3/PoE; vPC/VSS: switch L2/L3; Khác: mọi loại); thành viên cùng cụm phải cùng loại;
  đổi kiểu cụm khi có thành viên không hợp → 400. API cụm trả `memberType`; form thiết bị và hộp "Thêm vào cụm" chỉ liệt kê cụm
  hợp với loại thiết bị. Khác model/firmware sẽ là cảnh báo ở P1-20. Cụm không bắt buộc.
- Test / cách kiểm tra: Go — camera vào stack, switch L2 vào stack L3, trộn loại trong cụm "Khác", đổi stack → HA: đều 400; stack
  L3 → VSS: OK; 3 mutation backend + 1 frontend đều bị bắt. Vitest 167 pass. `make check` pass.
- Còn dở / lỗi đã biết: cảnh báo khác model/firmware ở P1-20.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-10** IPAM cơ bản.

## 2026-10-16 — Sắp lại chỗ quản lý Template và Cụm thiết bị (theo SRS §2)
- Đã làm (người dùng chốt phương án đề xuất):
  - Bỏ 2 menu riêng "Cụm thiết bị" và "Template thiết bị" ở nhóm chính (SRS §2 không có).
  - **Template:** chuyển vào nhóm **Quản trị** (chỉ owner/admin/editor tổ chức thấy) — thư viện dùng chung của tổ chức; từ P1-15
    dùng trong panel thư viện của sơ đồ.
  - **Cụm:** quản lý ngay **trong trang thiết bị** — thẻ "Cụm" ở tab Tổng quan: thêm vào cụm có sẵn (cùng site/đơn vị) hoặc tạo cụm
    mới rồi vào luôn; sửa cụm; rời cụm (thành viên cuối rời thì cụm tự xóa); danh sách thành viên có link. Danh sách Thiết bị có
    bộ lọc **Cụm** (lọc + đếm ở server, `clusterId`) — chỉ hiện khi tổ chức đã có cụm. Từ P1-16: gộp cụm trên sơ đồ.
- Test / cách kiểm tra: Go thêm kiểm tra lọc/đếm theo cụm; Vitest 167 pass (test tạo cụm chuyển sang luồng từ trang thiết bị);
  ảnh chụp + axe 5 trang × sáng/tối: 0 lỗi; `make check` pass.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-10** IPAM cơ bản.

## 2026-10-16 — P1-09b Cụm thiết bị
- Đã làm:
  - **Migration 000013:** `device_clusters` (kiểu HA active-passive / active-active / stack / vPC / VSS / khác; tên duy nhất
    trong tổ chức; hostname cụm; IP quản trị cụm dạng CIDR; site + đơn vị sở hữu); thiết bị thêm `cluster_id`, `cluster_role`
    (primary/secondary/member), `cluster_member_no` (duy nhất trong cụm). Unique index hostname thay bằng kiểm tra ở API.
  - **Quy tắc (ADR-027, ghi "Chi tiết triển khai"):** thành viên cùng site và đơn vị với cụm; **hostname được trùng chỉ giữa các
    thành viên cùng cụm** (switch stack), kiểm tra dưới khóa transaction; rời cụm khi còn trùng hostname → 409; đổi site/đơn vị
    cụm khi còn thành viên → 400; xóa cụm còn thành viên → 409. Quyền và hiển thị theo đơn vị/site như thiết bị (ADR-031).
  - **API:** CRUD cụm (chi tiết kèm danh sách thành viên); gán thành viên qua thiết bị (`clusterId`, `clusterRole`,
    `clusterMemberNo`); thiết bị trả tên/kiểu cụm. Audit `cluster.*`; thay đổi thành viên nằm trong `device.update`.
  - **Giao diện:** trang "Cụm thiết bị" (danh sách, thêm/sửa, xem thành viên, xóa); form thiết bị có mục Cụm (chỉ hiện cụm cùng
    site/đơn vị), vai trò, số thứ tự; trang thiết bị hiện cụm (link); cột Cụm trong danh sách (ẩn mặc định).
- Test / cách kiểm tra:
  - Go `cluster_test.go`: test chéo tổ chức cho mọi endpoint cụm (kể cả vào cụm/site của tổ chức khác); stack chung hostname,
    trùng hostname ngoài cụm → 409, số thứ tự trùng, thành viên khác site, rời cụm khi trùng hostname; 8 request tạo cùng
    hostname đồng thời → đúng 1 thành công; quyền theo đối tác/đơn vị. Mutation check 8 điểm backend (kể cả bỏ khóa) + 3 điểm
    frontend — đều bị bắt.
  - Vitest 167 pass. Ảnh chụp + axe 5 trang × sáng/tối: 0 lỗi. `make check` pass.
  - Dev DB: chạy `make migrate-up` (000013) rồi khởi động lại `make dev-api`.
- Còn dở / lỗi đã biết:
  - Hiển thị cụm gộp/mở rộng trên sơ đồ: làm cùng editor (P1-14, P1-16).
  - Rule "IP trùng được bỏ qua trong cụm": P1-20 (đã có `cluster_id` để dùng).
  - IP quản trị cụm là một trường của cụm, chưa có "interface ảo của cụm".
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-10** IPAM cơ bản (VLAN, subnet, mức sử dụng, gợi ý IP trống).

## 2026-10-16 — P1-09 Template & interface
- Đã làm:
  - **Migration 000012:** `device_templates` (theo tổ chức: loại, hãng, model, part number, chiều cao U, nhóm cổng dạng mẫu tên
    `Gi1/0/{n}` + số bắt đầu + số cổng + media/tốc độ/PoE); `interfaces` (physical/svi/loopback/tunnel/subinterface/lag, media,
    tốc độ, duplex, mode, access/native VLAN, VLAN cho phép, PoE, LAG cha cùng thiết bị, mô tả, bật/tắt; tên không trùng trong
    thiết bị); `ip_addresses` (CIDR giữ host bits, VRF, vai trò primary/secondary/nat/public — IP chính/phụ bắt buộc gắn interface,
    NAT/public có thể gắn thẳng thiết bị; một IP chính mỗi interface mỗi họ IPv4/IPv6); thiết bị thêm `mgmt_interface_id`,
    `poll_address`, `template_id` (FK ghép theo thiết bị / tổ chức).
  - **API:** CRUD template (owner/admin/editor tổ chức ghi, mọi thành viên đọc); tạo thiết bị kèm `templateId` → điền hãng/model/
    part number/chiều cao còn trống và sinh cổng vật lý; "áp template" cho thiết bị có sẵn (chỉ thêm cổng còn thiếu); CRUD interface
    và IP theo thiết bị (quyền theo thiết bị như P1-08); chọn interface quản trị → **IP quản trị = IP chính của interface đó**
    (ADR-012); `pollAddress`; danh sách thiết bị có cột IP quản trị, sắp xếp theo IP, tìm theo IP. Thay đổi interface/IP ghi
    audit dưới thiết bị (`interface.*`, `ip.*`, `device.apply_template`) nên hiện trong tab Lịch sử; `template.*` cho template.
  - **Giao diện:** tab Interfaces (bảng cổng + IP, thêm/sửa/xóa, đặt làm interface quản trị, áp template), tab IP (thêm/sửa/xóa,
    gắn interface hoặc NAT/public trên thiết bị); form thiết bị chọn template khi tạo, chọn interface quản trị + địa chỉ poll khi
    sửa; trang "Template thiết bị" (nhóm cổng, xem trước tên cổng, điền nhanh từ 5 mẫu phổ biến: Cisco C9200/C9300, FortiGate
    100F, Aruba CX 6100, MikroTik CCR2004); cột IP quản trị trong danh sách.
- Test / cách kiểm tra:
  - Go `interface_test.go`: test chéo tổ chức cho mọi endpoint template/interface/IP/áp template (kể cả dùng template, interface
    của tổ chức khác); template sai (thiếu `{n}`, quá 1024 cổng, trùng tên cổng, media sai), trùng tên; sinh cổng + giá trị mặc
    định từ template; áp lại không thêm; interface trùng tên, VLAN sai, LAG cha sai; IP chính thứ hai → 409, IPv6 tách riêng, IP
    chính không interface → 400; IP quản trị, sắp xếp/tìm theo IP; xóa interface quản trị → mất IP quản trị; lịch sử; quyền theo
    đối tác/đơn vị. Mutation check 10 điểm backend + 3 điểm frontend.
  - Vitest 165 pass (3 test mới). Ảnh chụp + axe 7 trang × sáng/tối: 0 lỗi. `make check` pass.
  - Dev DB: chạy `make migrate-up` (000012) rồi khởi động lại `make dev-api`.
- Còn dở / lỗi đã biết:
  - Chưa kiểm IP trùng giữa các thiết bị — rule validation P1-20 (trừ cụm HA, P1-09b). VLAN/subnet và gợi ý IP trống: P1-10.
  - Template theo tổ chức; thư viện model theo hãng dùng chung là Phase 2 (SRS §4.3). Icon tùy chỉnh chưa làm.
  - Sửa template không đổi cổng của thiết bị đã tạo (có nút "Áp template" để thêm cổng còn thiếu).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-09b** Cụm thiết bị (HA/stack).

## 2026-10-16 — P1-08 Kho thiết bị
- Đã làm:
  - **Migration 000011:** bảng `devices` theo SRS §4.1 (nhận dạng, vị trí đơn vị/site/location/rack + U, vận hành, vòng đời
    planned/active/spare/rma/retired, `managed`, mua sắm & hỗ trợ dạng ngày, tag, custom fields JSON) với FK ghép theo tổ chức và
    theo site (location/rack phải thuộc đúng site); hostname duy nhất trong tổ chức (không phân biệt hoa thường, chỉ thiết bị chưa
    xóa); `custom_field_defs` (text/number/date/boolean/select, bắt buộc, thứ tự).
  - **Quy tắc:** thiết bị ở site của đơn vị thì thuộc đơn vị đó; ở site dùng chung phải chọn đơn vị sở hữu (ADR-026). Chọn rack thì
    location theo rack; kiểm tra chồng U và vượt chiều cao rack. Xóa site/location/rack/đơn vị còn thiết bị → 409.
  - **Quyền (ADR-031):** thấy thiết bị khi đơn vị của nó được giao (trực tiếp/qua đối tác) hoặc site của nó nhìn thấy được (kể cả
    share) — lọc trong SQL. Sửa: quyền sửa ở đơn vị, hoặc share sửa của site. Chuyển đơn vị/site và xóa cần quyền sửa trực tiếp ở
    đơn vị (không qua share).
  - **API:** danh sách phân trang + lọc (q, đối tác, đơn vị, site, loại, hãng, vòng đời, vai trò, tag) + sắp xếp ở server, kèm số
    đếm cho từng bộ lọc; CRUD có khóa version; sửa hàng loạt (vòng đời, vai trò, phụ trách, quản lý, thêm/bỏ tag) và xóa hàng loạt
    theo kiểu tất cả hoặc không; lịch sử thiết bị từ audit; CRUD trường tùy biến (owner/admin). Audit `device.*`, `custom_field.*`.
  - **Giao diện:** trang Thiết bị dùng dữ liệu thật (bỏ dữ liệu mẫu — chỉ còn trong thư viện giao diện dev); bộ chọn đối tác/đơn vị
    trên topbar áp vào danh sách; form thêm/sửa đủ nhóm trường + trường tùy biến; sửa/xóa hàng loạt; trang chi tiết có Tổng quan,
    Hợp đồng & bảo hành (các ngày), Lịch sử (ai, khi nào, đổi gì); các tab Interface/IP/Kết nối/Truy cập/Sơ đồ ghi rõ task sẽ có
    dữ liệu; trang "Trường tùy biến" trong Quản trị; Ctrl+K tìm thiết bị thật.
- Test / cách kiểm tra:
  - Go `device_test.go`: test chéo tổ chức cho mọi endpoint thiết bị và trường tùy biến; quy tắc (hostname trùng, site dùng chung,
    location/rack khác site, chồng U, trường tùy biến sai kiểu/thiếu bắt buộc); lọc/sắp xếp/phân trang/số đếm; quyền theo
    đối tác/đơn vị và share (thấy, sửa, không chiếm/không xóa qua share); hàng loạt tất cả-hoặc-không; chặn xóa site/rack/
    location/đơn vị còn thiết bị; audit. Mutation check 15 điểm backend + 5 điểm frontend — đều bị test bắt.
  - Vitest 162 pass (5 test mới cho thiết bị). Ảnh chụp + axe 6 trang × sáng/tối (owner và partner_admin): 0 lỗi. `make check` pass.
  - Dev DB: chạy `make migrate-up` (000011) rồi khởi động lại `make dev-api`.
- Còn dở / lỗi đã biết:
  - IP quản trị, interface, MAC chưa có (P1-09) nên cột IP quản trị tạm bỏ khỏi danh sách.
  - Tag lưu dạng mảng trên thiết bị (SRS §13 ghi bảng `tags`); đủ cho lọc/sửa hàng loạt — nếu cần quản lý tag riêng (màu, đổi tên
    hàng loạt) sẽ tách bảng sau.
  - Xuất/nhập Excel thuộc P1-21/P1-22; "khôi phục trong 30 ngày" chưa có giao diện (dữ liệu vẫn xóa mềm).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-09** Template & interface.

## 2026-10-16 — P1-07c Phân quyền theo đối tác/đơn vị & chia sẻ (ADR-029, ADR-031)
- Đã làm:
  - **Migration 000010:** `partner_members` (partner_admin/editor/viewer), `business_unit_members` (unit_admin/editor/viewer),
    `resource_shares` (site → đối tác hoặc đơn vị, xem/sửa); FK ghép theo tổ chức, gỡ khỏi tổ chức thì xóa luôn quyền;
    thêm vai trò tổ chức `member`; **bỏ `site_scope`**.
  - **Quyền (backend):** middleware nạp quyền đối tác/đơn vị của người gọi; site lọc ngay trong SQL (đơn vị được giao, trực tiếp
    hoặc qua đối tác, hoặc site được share tới); đối tác/đơn vị ngoài quyền → 404. Mức quyền = cao nhất giữa tổ chức / đối tác /
    đơn vị, share nâng tối đa tới "sửa". Chi tiết các quy tắc ghi vào ADR-031 (mục "Chi tiết triển khai").
  - **API:** `/partners/{id}/members`, `/business-units/{id}/members` (mời email — email mới nhận link một lần, đổi quyền có
    khóa version, thu hồi); `/sites/{id}/shares` (tạo/đổi/thu hồi); membership trả `partnerGrants`/`unitGrants`; đối tác, đơn
    vị, site trả `access` (view/edit/admin). Audit `grant.*`, `share.*`, `member.add` khi mời người mới.
  - **Giao diện:** bộ chọn "Tất cả đối tác / đối tác / đơn vị" trên topbar (chỉ lọc hiển thị, nhớ theo tổ chức); khối "Người
    dùng của …" ở trang đối tác và đơn vị cho admin; tab "Chia sẻ" ở trang site cho admin; nút sửa/xóa/thêm theo `access`;
    form chỉ liệt kê đối tác/đơn vị được phép thêm vào; user `member` không thấy menu/lệnh Thành viên; trang Thành viên bỏ
    phần giới hạn site, thêm vai trò "Chỉ theo đối tác/đơn vị".
- Test / cách kiểm tra:
  - Go `permission_test.go`: hiển thị theo quyền (partner_admin, editor đơn vị, viewer đối tác khác, owner); 404 cho mọi thứ
    ngoài quyền; ghi trong phạm vi (thêm/sửa/xóa site, chuyển site, đơn vị, đối tác); mời/đổi/thu hồi quyền, chống trùng, khóa
    version, unit_admin không đụng đơn vị khác; share xem/sửa, không xóa/không chiếm site qua share, thu hồi share → 404;
    test chéo tổ chức cho mọi endpoint mới; số dòng audit.
  - Mutation check backend 15 điểm (bỏ lọc SQL, share bỏ qua quyền bên nhận, bỏ kiểm admin khi cấp quyền/share/xóa, chuyển
    site không cần quyền hai bên…) — đều có test fail. Frontend: 4 mutation (xóa đối tác, tab chia sẻ, menu Thành viên, bộ lọc
    topbar) — đều bị bắt.
  - Vitest 160 test pass (4 test mới). Ảnh chụp giao diện thật (partner_admin, owner): đúng. axe 7 trang × sáng/tối: 0 lỗi.
    `make check` pass (test Go chạy lại không cache trên DB thật).
  - Dev DB: đã chạy `make migrate-up` (000008–000010); khởi động lại `make dev-api` để dùng code mới.
- Còn dở / lỗi đã biết:
  - partner_admin/unit_admin chưa cấp lại được link mời đã mất (chỉ owner/admin tổ chức qua trang Thành viên).
  - Share mới áp cho site; thiết bị lẻ/sơ đồ tổng quan dùng cùng bảng ở task sau (ADR-029).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không (các chi tiết suy ra từ ADR-029/031 đã ghi vào ADR-031).
- Task tiếp theo đề xuất: **P1-08** Kho thiết bị.

## 2026-10-16 — P1-07b Cấp Đối tác (ADR-031)
- Đã làm:
  - **Migration 000009:** bảng `business_units` cũ đổi tên thành `partners` (giữ id, mã, quan hệ, liên hệ); bảng
    `business_units` mới (`partner_id` bắt buộc, FK ghép `(partner_id, organization_id)`, mã duy nhất trong đối tác);
    mỗi đối tác sinh đơn vị `MAIN` và mọi site chuyển sang đơn vị đó — mã site không đổi. Down migration trả lại như cũ
    (đã thử up/down trên DB nháp có dữ liệu).
  - **API:** `/partners` (CRUD, owner/admin; xóa bị chặn khi còn đơn vị; đổi mã đối tác đổi tiền tố mã mọi site của đối tác
    trong cùng transaction), `/business-units` (CRUD, lọc `partnerId`; đối tác chọn lúc tạo, không đổi sau; xóa bị chặn khi còn
    site; đổi mã đơn vị không ảnh hưởng site). Site trả thêm `partnerId/partnerCode/partnerName`, lọc `partnerId`; mã site
    kiểm tra tiền tố = mã **đối tác** của đơn vị; `next-code` nhận `partnerId`. Admin hệ thống thấy thêm số đối tác. Audit
    `partner.*`, `business_unit.*`.
  - **Giao diện:** "Đơn vị & Sites" có 3 tab Đối tác / Đơn vị / Sites; trang đối tác (thông tin, bảng đơn vị, bảng site,
    nút Thêm đơn vị điền sẵn đối tác); trang đơn vị hiện đối tác (link); breadcrumb Đơn vị & Sites › AGRI › MAIN › site;
    form đơn vị chọn đối tác (khóa khi sửa); form site chọn đơn vị nhóm theo đối tác, gợi ý mã theo đối tác; bảng site có
    cột + bộ lọc Đối tác, bộ lọc đơn vị ghi `AGRI › MAIN` (mã đơn vị trùng giữa các đối tác); Ctrl+K có nhóm Đối tác;
    trang Tất cả tổ chức có cột Đối tác.
- Test / cách kiểm tra:
  - Go: `partner_test.go` thay `business_unit_test.go` — test chéo tổ chức cho mọi endpoint đối tác/đơn vị (kể cả gắn đơn vị
    vào đối tác của tổ chức khác, lọc `partnerId` của tổ chức khác); quy tắc mã đối tác/đơn vị; mã site theo đối tác (mã đơn
    vị làm tiền tố bị từ chối); next-code; lọc; đổi mã đối tác đổi mã site, không đụng site dùng chung; đổi mã đơn vị không
    đổi mã site; xóa từ dưới lên; số dòng audit. `org_test` kiểm tra số đối tác/đơn vị/site.
  - Mutation check: so tiền tố với mã đơn vị → test fail; bỏ chặn xóa đơn vị còn site → test fail; form site dùng mã đơn vị
    làm tiền tố → test frontend fail.
  - Vitest 157 pass (4 test mới cho đối tác/đơn vị). Ảnh chụp + axe 10 trang × sáng/tối: 0 lỗi. `make check` pass.
  - Dev DB: chạy `make migrate-up` (000008, 000009) rồi khởi động lại `make dev-api`.
- Còn dở / lỗi đã biết:
  - Quản lý đối tác/đơn vị vẫn chỉ owner/admin tổ chức; partner_admin/unit_admin và `site_scope` → thay ở P1-07c.
  - Trang đối tác chỉ liệt kê site (thêm site từ trang đơn vị — đơn vị quyết định chủ sở hữu).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **P1-07c** Phân quyền theo đối tác/đơn vị & chia sẻ — sẽ trình bày kế hoạch trước (nặng về bảo mật).

## 2026-10-16 — Thêm cấp Đối tác: Tổ chức → Đối tác → Đơn vị (ADR-031)
- Đã làm (chỉ tài liệu, chưa code):
  - **ADR-031:** đơn vị bắt buộc thuộc một đối tác; quan hệ với tổ chức chuyển lên đối tác; mã đối tác theo quy tắc cũ của mã
    đơn vị, mã đơn vị duy nhất trong đối tác, **mã site theo mã đối tác** (`AGRI-BD01` giữ nguyên); giao quyền ở cấp đối tác
    (partner_admin/editor/viewer, có hiệu lực với mọi đơn vị con) hoặc cấp đơn vị (unit_admin/editor/viewer), quyền = hợp;
    partner_admin/unit_admin quản lý user, đơn vị/site trong phạm vi; share site cho đối tác hoặc đơn vị; bộ chọn đối tác/đơn vị.
  - Ghi chú "Thay đổi sau" vào ADR-026, 029, 030. SRS §1, §2, §3, §10, §13 cập nhật. PLAN: thêm **P1-07b** (cấp đối tác),
    viết lại **P1-07c** (phân quyền 2 cấp + share), P1-08 lọc theo đối tác/đơn vị.
- Ảnh hưởng tới phần đã code (chưa sửa — chờ duyệt):
  - **P1-07b (~2,5–3 ngày):** migration 000009 — đổi `business_units` hiện có thành `partners` (giữ id, mã, quan hệ, liên hệ);
    tạo bảng `business_units` mới (`partner_id`, mã duy nhất trong đối tác); mỗi đối tác hiện có tự sinh **một đơn vị mặc định**
    (mã `MAIN`, tên = tên đối tác) và mọi site đang gắn đối tác chuyển sang đơn vị đó — mã site không đổi. API: CRUD đối tác,
    CRUD đơn vị dưới đối tác, site gắn đơn vị (tiền tố mã = đối tác), next-code theo đối tác. Giao diện: tab Đối tác, trang đối
    tác (đơn vị + site), form site chọn đơn vị (nhóm theo đối tác). Test chéo tổ chức cho mọi endpoint mới.
  - **P1-07c (~3,5–4,5 ngày):** bảng giao quyền 2 cấp + `resource_shares` (đích đối tác/đơn vị); một hàm quyền chung
    "user xem/sửa được site nào" (owner/admin tổ chức → tất cả; còn lại → site của đơn vị được giao trực tiếp hoặc qua đối tác,
    cộng site được share); bỏ `site_scope`; màn hình thành viên đối tác/đơn vị cho partner_admin/unit_admin, màn hình share site,
    bộ chọn trên topbar; test chéo đối tác/đơn vị (user AGRI không đọc/sửa FOOD; unit_admin NM không sửa đơn vị VP cùng đối tác;
    share xem → không sửa; thu hồi share → 404).
  - Tổng **~6–7,5 ngày** trước P1-08. Thứ tự: P1-07b → P1-07c → P1-08.
- Đã chốt sau (2026-10-16): đổi module Phase 2 thành "Nhà cung cấp & hợp đồng" (SRS §8, PLAN P2-04, CLAUDE.md: `vendors`);
  đơn vị mặc định mã `MAIN`.
- Câu hỏi cho người dùng (đã trả lời — xem dòng trên):
  1. **Trùng tên "Đối tác":** module Phase 2 (SRS §8) "Đối tác & hợp đồng" là hãng / nhà cung cấp / ISP / đơn vị bảo trì — khác
     với cấp đối tác mới. Đề xuất đổi tên module Phase 2 thành **"Nhà cung cấp & hợp đồng"** (bảng `vendors`), giữ "Đối tác" cho cấp
     mới. Đồng ý không?
  2. Đơn vị mặc định khi chuyển dữ liệu cũ đặt mã `MAIN` được không?
- Đề xuất quyết định cần chốt: 2 câu trên.
- Task tiếp theo đề xuất: P1-07b — trình kế hoạch chi tiết trước khi code.

## 2026-10-16 — Làm rõ "tổ chức" trên giao diện; số đơn vị/site trong khu vực Hệ thống
- Bối cảnh: người dùng hỏi đơn vị thuộc tổ chức nào khi form không có ô chọn tổ chức. Giải thích: tổ chức = khách hàng của
  bên vận hành (GVN), lấy từ đường dẫn `/o/{orgId}` (ADR-023, không lấy từ body); đơn vị luôn thuộc tổ chức đang mở và
  "quan hệ" của đơn vị là quan hệ với tổ chức đó, không phải với GVN. Không đổi mô hình dữ liệu.
- Đã làm:
  - Giao diện ghi rõ tổ chức: tiêu đề "Đơn vị & Sites — <tổ chức>", dialog "Thêm đơn vị vào <tổ chức>",
    "Thêm site vào <tổ chức>", nhãn "Quan hệ với <tổ chức>" + lựa chọn "Đối tác của <tổ chức>"…, trang đơn vị ghi
    "Đối tác của <tổ chức>"; nhóm liên hệ trong form đơn vị đổi thành "Liên hệ của đơn vị" (hết trùng nhãn).
  - API `GET /admin/organizations` thêm `unitCount`, `siteCount` (chỉ số đếm — system admin không phải thành viên vẫn
    không đọc nội dung dữ liệu tổ chức, đúng ADR-023); trang Hệ thống › Tất cả tổ chức thêm 2 cột.
- Test / cách kiểm tra: `make check` pass; test backend số đơn vị/site trong danh sách admin; test frontend tiêu đề, cột,
  dialog và lựa chọn quan hệ có tên tổ chức. Ảnh `23-*`, `36..38-*`, `42..44-*`; axe-core 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-07c Phân quyền theo đơn vị & chia sẻ site (ADR-029) — trình kế hoạch trước khi code.

## 2026-10-16 — P1-07 hoàn tất: Đơn vị, loại site, site dùng chung, quy tắc mã (ADR-026, ADR-030)
- Đã làm:
  - Migration 000008: `business_units` (mã theo ADR-030 ép bằng CHECK ở DB, cấm `SHARED`, duy nhất với đơn vị còn sống;
    relation subsidiary/partner/customer; liên hệ; xóa mềm); `sites.kind` (office/factory/datacenter/warehouse/store/other,
    site cũ → office), `sites.business_unit_id` (NULL = dùng chung; khóa ngoại kép cùng tổ chức), `sites.isp`.
  - API: CRUD `/orgs/{orgId}/business-units` (owner/admin; editor/viewer chỉ xem); đổi mã đơn vị → đổi tiền tố mã mọi site
    của đơn vị trong cùng transaction (audit ghi số site đổi); xóa đơn vị còn site → 409. Site: `kind`, `businessUnitId`,
    `isp`, trả `businessUnitCode/Name`; lọc `?businessUnitId=` / `?shared=true`; mã site bắt buộc `<ĐƠN VỊ>-<địa điểm 2–4 chữ><2 số>`
    và tiền tố phải đúng đơn vị của site (`SHARED-` cho site dùng chung); `GET /sites/next-code?businessUnitId=&place=`
    trả số tiếp theo còn trống.
  - Giao diện: menu **Đơn vị & Sites** (tab Đơn vị / Sites); bảng đơn vị (mã, tên, quan hệ, liên hệ, số site) + dòng "Dùng chung";
    trang chi tiết đơn vị (thông tin + site của đơn vị, thêm site có sẵn đơn vị, xóa phải gõ mã); bảng site thêm cột Đơn vị,
    Loại, Nhà mạng (ẩn mặc định), lọc theo đơn vị (gồm "Dùng chung") và loại; form site chọn đơn vị / loại, **mã địa điểm tự
    suy từ tên/địa chỉ** (Hưng Yên → HY, Nhà máy Bình Định → BD; `lib/placeCode.ts`) và **mã site tự gợi ý** qua API cho tới khi
    người dùng tự gõ, kiểm tra quy tắc ngay trên form; trang site hiện loại + đơn vị, breadcrumb Đơn vị & Sites › AGRI › AGRI-BD01;
    Ctrl+K tìm đơn vị.
- Test / cách kiểm tra: `make check` pass (backend + 155 test frontend).
  - Backend: chéo tổ chức cho mọi endpoint đơn vị + gắn site vào đơn vị tổ chức khác → 400; editor không tạo đơn vị; mã đơn vị
    sai (ngắn, số đầu, dài, ký tự lạ, `shared`) 400, trùng 409, lưu chữ hoa; mã site sai tiền tố / thiếu số / địa điểm dài /
    loại sai 400; next-code (BD02, SHARED-HCM02, địa điểm sai 400); lọc theo đơn vị / dùng chung; đổi mã đơn vị đổi mã site;
    xóa đơn vị còn site 409; test site cũ chuyển sang mã đúng quy tắc. Mutation: bỏ kiểm tra tiền tố, bỏ đổi tên dây chuyền →
    test fail.
  - Frontend: danh sách đơn vị + tạo (mã tự viết hoa, bỏ ký tự lạ), thêm site từ trang đơn vị (đơn vị điền sẵn, gọi
    next-code với place=BD), tạo site dùng chung (mã sai → nút Lưu tắt), `placeCode`.
  - Ảnh `docs/ui-screens/after/36-*, 37-*, 38-*, 42..44-*`; `a11y-report.md` 0 vấn đề.
- Còn dở / lỗi đã biết:
  - **DB dev của mày:** chạy `make migrate-up` (000008). Site tạo trước đây (mã kiểu `HQ`) vẫn đọc được nhưng sửa sẽ bị
    bắt đổi mã theo quy tắc (vd `SHARED-HN01`) — dữ liệu dev chỉ là dữ liệu thử.
  - Giới hạn theo site (`site_scope`) vẫn còn, sẽ thay ở P1-07c (ADR-029); bảng đơn vị hiện ai trong tổ chức cũng xem được.
  - Loại site không tự đoán từ tên ("Nhà máy …" vẫn mặc định Văn phòng).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-07c Phân quyền theo đơn vị & chia sẻ site (ADR-029), rồi P1-08.

## 2026-10-16 — Chốt phân quyền theo đơn vị, chia sẻ bản ghi, quy tắc mã (ADR-029, ADR-030)
- Đã làm (chỉ tài liệu, chưa code):
  - **ADR-029:** giao user theo một hoặc nhiều đơn vị (`bu_admin`/`editor`/`viewer`, thấy hợp các đơn vị); bu_admin mời
    email mới hoặc user có sẵn và phân quyền trong đơn vị mình; bảng chung `resource_shares` (xem/sửa) áp cho **site** trước —
    site dùng chung (IDC) chỉ hiện với đơn vị được share, được share thì thấy mọi thứ trong site; bộ chọn đơn vị trên topbar
    (chỉ là bộ lọc, quyền kiểm ở server); **bỏ `site_scope`**.
  - **ADR-030:** mã đơn vị 2–8 ký tự `A–Z0–9` bắt đầu bằng chữ (vd `AGRI`); mã site `<ĐƠN VỊ>-<địa điểm><STT>`
    (vd `AGRI-BD01`), site dùng chung `SHARED-…`; bắt buộc ở server + tự gợi ý trên form.
  - ADR-025 thêm dòng "Thay đổi sau" (sơ đồ một site → ADR-028; site_scope → ADR-029); ADR-026 trỏ sang ADR-029;
    SRS §3 (mã theo ADR-030), §10 (phân quyền động, bỏ giới hạn theo site); PLAN: P1-07 thêm quy tắc mã, **P1-07c** mới.
- Ảnh hưởng tới phần đã code (chưa sửa — chờ duyệt bắt đầu):
  1. **P1-07 (đơn vị, kind, site dùng chung, quy tắc mã):** migration `business_units`, `sites.kind/business_unit_id/isp`;
     mã site hiện có không theo quy tắc mới → migration giữ nguyên, sửa sẽ bị bắt theo quy tắc (hoặc đổi tên một lần bằng
     script; dữ liệu dev hiện chỉ có dữ liệu thử). ~2,5–3 ngày.
  2. **P1-07c (phân quyền theo đơn vị + share):** bảng `business_unit_members`, `resource_shares`; bỏ `memberships.site_scope`
     (gỡ `SiteFilter`/`siteScope` trong API, test, sheet Thành viên); hàm quyền chung "site nào user này xem/sửa được" thay cho
     `SiteFilter`, dùng lại cho thiết bị/sơ đồ; màn hình thành viên đơn vị cho bu_admin, màn hình share site, bộ chọn đơn vị;
     test chéo đơn vị (user FOOD không đọc/sửa được site AGRI, site không share → 404, share xem → không sửa được). ~3–4 ngày.
  - Tổng **~6–7 ngày** trước P1-08. Thứ tự đề xuất: P1-07 (đơn vị + mã) → P1-07c → P1-08.
- Câu hỏi cho người dùng: không còn câu mở cho phần mô hình. Chờ lệnh bắt đầu sửa code.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-07 (bổ sung đơn vị, kind, site dùng chung, quy tắc mã) — sẽ trình kế hoạch chi tiết trước khi code.

## 2026-10-16 — Mô hình Tổ chức → Đơn vị → Site; cụm HA; sơ đồ nhiều cấp
- Đã làm (chỉ tài liệu, chưa code):
  - `docs/DECISIONS.md`: **ADR-026** Cấp Đơn vị giữa Tổ chức và Site, **ADR-027** Cụm thiết bị (HA, stack),
    **ADR-028** Sơ đồ nhiều cấp và drill-down (số ADR lớn nhất trước đó là 025).
  - `docs/SRS.md`: §1 phân cấp; §2 menu "Đơn vị & Sites"; §3 Đơn vị + Site có loại/đơn vị/dùng chung/nhà mạng; §4.1 thêm Đơn vị,
    dòng Cụm, End-of-Sale/End-of-Support; §4.5 Cụm thiết bị; §6.1 sơ đồ có phạm vi tổ chức/đơn vị/site + sơ đồ nhiều cấp;
    §7 trùng IP/hostname bỏ qua trong cụm + rule quá End-of-Support; §10 giới hạn theo đơn vị và/hoặc site; §12 import ánh xạ
    Site→Đơn vị, Location→Site, gộp tên gần giống, đề xuất cụm HA, Person in charge; §13 business_units, device_clusters,
    diagrams.scope; §16 checklist import file mẫu khách.
  - `docs/PLAN.md`: P1-03, P1-07 (đổi tên + mở lại), P1-08, **P1-09b** mới, P1-13, P1-21, P1-25 (seed "Tập đoàn Mẫu"),
    **P2-21**, **P2-22** mới.
- Ảnh hưởng tới phần ĐÃ CODE (chưa sửa — chờ duyệt):
  1. **P1-07 (đã làm site/location/rack + site_scope)** — đã bỏ tick trong PLAN vì định nghĩa mới có thêm đơn vị:
     - Migration 000008: bảng `business_units` (organization_id, code duy nhất trong tổ chức, name, relation:
       subsidiary/partner/customer, liên hệ, ghi chú, version, deleted_at, UNIQUE(id, organization_id));
       `sites.kind` (office/factory/datacenter/warehouse/store/other, site hiện có → `office`);
       `sites.business_unit_id` null được, khóa ngoại kép `(business_unit_id, organization_id)`; `sites.isp` (nhà mạng chính).
       Site hiện có giữ `business_unit_id = NULL` (= dùng chung) — không mất dữ liệu.
     - API: CRUD `/orgs/{orgId}/business-units` (+ test chéo tổ chức, vai trò, audit); `SiteInput` thêm `kind`,
       `businessUnitId`, `isp`; danh sách site lọc theo đơn vị.
     - Giao diện: trang Đơn vị (danh sách + chi tiết với các site của đơn vị), form site chọn loại + đơn vị/"dùng chung",
       bảng site nhóm/lọc theo đơn vị, menu đổi thành "Đơn vị & Sites", Ctrl+K tìm đơn vị.
     - Ước lượng: ~2,5–3 ngày (DB + API + test ~1,5; giao diện ~1–1,5).
  2. **P1-03/P1-04 (membership)** — thêm `memberships.business_unit_scope uuid[]`; `PATCH members` nhận `businessUnitScope`;
     `tenant.Membership` lọc site theo cả đơn vị và site; sheet Thành viên thêm "Giới hạn đơn vị". Ước lượng ~1 ngày.
  3. **ADR-025** mâu thuẫn một phần với ADR-028: "mỗi sơ đồ thuộc đúng một site" đã được thay bằng phạm vi
     tổ chức/đơn vị/site (SRS §6.1 đã sửa theo ADR-028). Các ý khác của ADR-025 (cây location, rack, site_scope chỉ cho
     editor/viewer, xóa mềm) vẫn đúng. Chưa sửa ADR-025 vì ngoài phạm vi yêu cầu.
  4. Chưa code nên không ảnh hưởng: P1-08 (thiết bị, `business_unit_id`), P1-09b (cụm), P1-13 (diagram scope), P1-21, P1-25.
     Dữ liệu mẫu ở trang Thiết bị (frontend) sẽ bị thay ở P1-08 như kế hoạch.
  - Tổng ước lượng phần sửa lại: **~3,5–4 ngày**, nên làm trước P1-08 vì thiết bị cần `business_unit_id`.
- Câu hỏi cho người dùng (cần chốt trước khi sửa code):
  1. Thành viên có cả giới hạn đơn vị và giới hạn site: lấy **hợp** (thấy site của đơn vị được giao + các site được giao lẻ)
     hay **giao** (chỉ site vừa thuộc đơn vị vừa nằm trong danh sách)? Đề xuất: hợp.
  2. Thành viên bị giới hạn theo đơn vị có thấy **site dùng chung** (vd IDC HCM) không, và thấy những gì trong đó?
     Đề xuất: thấy site dùng chung nhưng chỉ thấy thiết bị có `business_unit_id` thuộc đơn vị của mình (P1-08).
  3. Mã đơn vị có bắt buộc và duy nhất trong tổ chức như mã site không? Đề xuất: có.
  4. Thêm ghi chú "ý sơ đồ một site đã thay bởi ADR-028" vào ADR-025 không? Đề xuất: có (một dòng).
- Đề xuất quyết định cần chốt: 4 câu trên.
- Task tiếp theo đề xuất: sau khi duyệt — sửa P1-07 (đơn vị) + giới hạn đơn vị, rồi P1-08.

## 2026-10-16 — P1-07 Sites / Location / Rack
- Đã làm:
  - **ADR-025** (đã chốt): tổ chức (khách hàng) → nhiều site → cây location → rack; mỗi site nhiều thiết bị (P1-08) và nhiều
    sơ đồ (P1-13); **mỗi sơ đồ thuộc đúng một site** (sửa SRS §6.1: sơ đồ WAN đặt ở site chính); `site_scope` chỉ áp cho
    editor/viewer; xóa site = xóa mềm, chỉ owner/admin.
  - Migration 000007: `sites` (mã duy nhất trong tổ chức với site còn sống — xóa mềm giải phóng mã; múi giờ IANA; liên hệ
    tại chỗ), `locations` (building/floor/room, `parent_id`, tên duy nhất giữa anh em không phân biệt hoa thường), `racks`
    (1–60U, mặc định 42U, tên duy nhất trong location). **Khóa ngoại kép** `(site_id, organization_id)` /
    `(parent_id, site_id)` / `(location_id, site_id)` nên DB tự chặn gắn dữ liệu chéo tổ chức hoặc chéo site.
  - API (OpenAPI trước): CRUD `/orgs/{orgId}/sites`, `…/sites/{siteId}/locations`, `…/sites/{siteId}/racks`; optimistic lock;
    cây location ép cấp (tòa nhà ngay dưới site; tầng dưới tòa nhà/site; phòng dưới tầng/tòa nhà/site); xóa location còn
    con/rack → 409 có số lượng; xóa rack còn thiết bị → 409 (FK từ P1-08). Audit trước/sau cho mọi thao tác ghi.
  - **site_scope**: `PATCH members` nhận `siteScope {all, siteIds}` (chỉ owner/admin; id phải là site còn sống của tổ chức);
    `Member.siteScope` trả về. Thành viên bị giới hạn: danh sách chỉ có site trong phạm vi, site khác (và location/rack của
    nó) → 404, không tạo được site mới. `tenant.Membership.SiteFilter()` để P1-08/P1-13 dùng lại.
  - Giao diện: menu **Sites**; danh sách site (mã, tên, địa chỉ, liên hệ, số location/rack); trang site với tab Location
    (cây, thêm đúng loại con, đổi tên/xóa tại chỗ), Rack (danh sách + mặt trước rack đánh số U từ dưới lên, ô trống tới P1-08),
    Thông tin, Thiết bị/Sơ đồ (khung chờ P1-08/P1-13); xóa site phải gõ mã; sheet Thành viên có "Giới hạn site", bảng thành
    viên có cột phạm vi; Ctrl+K tìm site.
- Test / cách kiểm tra: `make check` pass (backend + 151 test frontend).
  - Backend: chéo tổ chức cho mọi endpoint (đọc 404, ghi qua đường dẫn org B và org A đều 404, dữ liệu B không đổi);
    vai trò (viewer chỉ xem, editor tạo/sửa, chỉ owner/admin xóa site), validation (mã trùng không phân biệt hoa thường 409,
    múi giờ/email/mã sai 400), xóa mềm + tái dùng mã, cây location (sai cấp, cha ở site khác, trùng tên anh em, xóa bị chặn),
    rack (location site khác, 61U), site_scope (user.manage không đặt được, id tổ chức khác 400, danh sách lọc, 404 ngoài
    phạm vi, không tạo site, owner bỏ qua scope, gỡ giới hạn). Mutation: bỏ scope / bỏ ràng buộc cây / bỏ lọc tổ chức trong
    GetSite → đều có test fail.
  - Frontend: tạo site, cây location chỉ cho loại con hợp lệ và gửi parentId, rack view 42U, viewer chỉ xem, xóa site gõ mã,
    đặt giới hạn site cho editor.
  - Ảnh `docs/ui-screens/after/36..41-*`; `a11y-report.md` 0 vấn đề (36 trang × 2 theme).
- Còn dở / lỗi đã biết:
  - Chưa khôi phục site đã xóa mềm qua giao diện (dữ liệu còn trong DB).
  - Cây location chưa kéo thả đổi cha / sắp xếp (đổi tên được; `sort_order` có sẵn trong API).
  - Nút "Thêm site" vẫn hiện cho editor bị giới hạn (server trả 403 kèm lý do) — API tổ chức chưa trả phạm vi của chính mình.
  - Cần `make migrate-up` (000007) trên DB dev.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không (ADR-025 đã chốt).
- Task tiếp theo đề xuất: P1-08 Kho thiết bị (gắn site + location + rack/U, thay dữ liệu mẫu).

## 2026-10-16 — P1-06 App shell
- Đã làm (phần lớn khung đã có từ UI Bước 2–3; task này hoàn thiện phần còn lại theo SRS §2):
  - **Ngôn ngữ vi/en** trong menu tài khoản (tên ngôn ngữ ghi bằng chính ngôn ngữ đó), nhớ theo trình duyệt (`ntb-lang`),
    đồng bộ `<html lang>`. Chuỗi viết cứng còn lại (RequireAuth, RootRedirect, thông báo lỗi dự phòng của các hook) chuyển
    sang i18n (`errors.*`, `noOrg.*`).
  - **Ctrl+K** theo nhóm: Trang (chỉ trang được phép mở — Audit log chỉ owner/admin, mục Hệ thống chỉ system admin),
    Tổ chức khác (đổi tổ chức), Thành viên (mở trang Thành viên đã lọc sẵn qua `?q=`), Thiết bị (dữ liệu mẫu, ghi rõ tới P1-08;
    tìm theo hostname/IP/MAC/S/N/part number/site), Lệnh (đổi sáng/tối, đổi ngôn ngữ). Dữ liệu chỉ tải khi mở palette.
  - Đã có từ trước: menu trái theo SRS §2 (module chưa làm thì ẩn: IPAM, Sites, Đối tác, Kho mật khẩu, Giám sát, Báo cáo),
    thu gọn < 1440px, tên tổ chức luôn hiện + đổi tổ chức, thông báo (khung), Light/Dark/System, mật độ.
  - Sửa tham chiếu: dashboard đầy đủ là P1-24 (không phải P1-06).
- Test / cách kiểm tra: `make check` pass (145 test frontend): chuyển ngôn ngữ (menu đổi chữ, `lang`, localStorage), Ctrl+K
  tìm thành viên → trang Thành viên đã lọc, Ctrl+K đổi tổ chức, viewer không thấy Audit log/Hệ thống trong Ctrl+K.
  Ảnh `12-*`, `34-account-menu-*`, `35-devices-english-*`; axe-core 0 vấn đề.
- Còn dở / lỗi đã biết:
  - Thông báo lỗi do **backend** trả về vẫn là tiếng Việt khi chọn English (cần `Accept-Language` + bản dịch phía server —
    đề xuất làm khi có nhu cầu dùng tiếng Anh thật).
  - Định dạng ngày giờ/số vẫn theo vi-VN ở cả hai ngôn ngữ.
  - Tùy chọn giao diện/ngôn ngữ lưu theo trình duyệt, chưa lưu theo user phía server.
  - Thông báo (chuông) mới là khung trống — nội dung đến khi có cảnh báo hết hạn (P2) / trạng thái (P3).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-07 Sites/Location/Rack.

## 2026-10-16 — P1-05 Audit log
- Đã làm:
  - API (OpenAPI trước): `GET /api/orgs/{orgId}/audit` (owner/admin) và `GET /api/admin/audit` (system admin, chỉ sự kiện
    không thuộc tổ chức — đăng nhập, MFA, tài khoản, quản trị người dùng; ADR-023). Phân trang server (page/pageSize ≤ 200,
    total), lọc `category` (tiền tố action, nhiều giá trị), `actorId`, `from`/`to`, `q` (action / đối tượng / email,
    ký tự `%` `_` được escape). Mới nhất trước. Migration 000006: index cho sự kiện hệ thống và theo người thực hiện.
  - Bổ sung trước/sau cho vô hiệu hóa / kích hoạt lại / reset MFA người dùng (các thao tác ghi khác đã có từ P1-03/04).
  - Màn hình Audit log (Quản trị › Audit log, chỉ owner/admin thấy mục menu) và Hệ thống › Audit log: DataTable,
    lọc nhóm / khoảng thời gian (24h, 7 ngày, 30 ngày, 12 tháng) / người thực hiện, tên thao tác tiếng Việt qua i18n
    (action lạ hiện tên gốc), sheet chi tiết có bảng Trường | Trước | Sau tô dòng thay đổi, IP, trình duyệt, request ID.
  - Sửa: sheet không nhận độ rộng tùy chỉnh (ảnh hưởng cả sheet Thành viên); hook chỉ gọi API khi cần (`enabled`).
- Test / cách kiểm tra:
  - Backend: chặn chéo tổ chức (A không đọc audit B, dòng của B không lọt vào A), editor/viewer 403, admin 200, lọc +
    phân trang + escape LIKE + 400 khi tham số sai, audit hệ thống chỉ cho system admin và không chứa dòng của tổ chức,
    system admin không phải thành viên → 404 với audit tổ chức, trước/sau của `user.disable`. Mutation: bỏ escape, bỏ kiểm
    tra quyền, bỏ lọc tổ chức → đều có test fail.
  - Frontend: danh sách + sheet diff, filter gửi `category`/`from` lên API, chỉ một khoảng thời gian một lúc, viewer bị
    chuyển về Dashboard, audit hệ thống. `make check` pass (142 test frontend).
  - Ảnh `docs/ui-screens/after/31..33-*`; `a11y-report.md` 0 vấn đề (28 trang × 2 theme).
- Còn dở / lỗi đã biết:
  - Audit export: chưa có export phía server — ghi `export.*` khi làm P1-22 (đã ghi vào PLAN).
  - Đổi "tổ chức dùng gần nhất" (`/activate`) là tùy chọn giao diện, không ghi audit.
  - `object_id` của người dùng lúc là email (sự kiện tài khoản/quản trị), lúc là UUID (thành viên) — giữ như dữ liệu đã ghi.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không (quyền xem audit tổ chức = owner/admin, theo nhóm "Quản trị" của SRS §2).
- Task tiếp theo đề xuất: P1-06 App shell — phần lớn đã làm ở UI Bước 2–3; còn chuyển ngôn ngữ vi/en trong menu tài khoản
  và kết quả Ctrl+K từ API. Sau đó P1-07 Sites/Location/Rack.

## 2026-10-16 — UI Bước 3 · tách bundle theo route (kết thúc Bước 3)
- Đã làm: các trang module (Thiết bị, Thành viên, Quản trị, Tình trạng hệ thống) và editor tải lười (`React.lazy`);
  shell giữ nguyên khi trang con đang tải (Suspense + skeleton ở Outlet). Bundle chính 1.073 kB → 389 kB, editor 247 kB riêng.
  Dọn cảnh báo lint trong code mới (sort key ra module scope, map mức lỗi tách file).
- Test / cách kiểm tra: `make check` pass (138 test frontend). Chụp lại toàn bộ `docs/ui-screens/after/` (104 ảnh:
  26 màn × 1440/1280 × Light/Dark); `a11y-report.md`: 0 vấn đề trên 25 trang × 2 theme.
- Còn dở / lỗi đã biết: xem mục editor (thêm thiết bị bằng bàn phím, thông báo validation qua i18n). Cảnh báo
  only-export-components còn trong 3 file shadcn gốc (button/badge/tabs) — để nguyên theo mẫu shadcn.
- Câu hỏi cho người dùng: duyệt kết quả Bước 3.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-05 Audit log (màn hình) — dùng DataTable + FilterBar mới.

## 2026-10-16 — UI Bước 3 · editor sơ đồ (token màu + i18n)
- Đã làm:
  - React Flow theo token Light/Dark qua biến `--xy-*` (nền lưới, cạnh, handle, minimap, controls, vùng chọn, attribution).
  - Mọi nhãn qua i18n, kể cả nhãn trợ năng của React Flow (`ariaLabelConfig`): toolbar (Về tổ chức, Bám lưới, Cỡ lưới,
    Vừa màn hình, Khóa), Palette (nhóm thiết bị, bỏ viết hoa toàn bộ), Sidebar thuộc tính (nhãn + giá trị vai trò/vòng đời/
    mode/trạng thái link), LinkDialog (dùng Dialog chung), Problems.
  - Problems: icon + chữ + màu theo mức (bỏ chấm màu và emoji), đặt **dưới** canvas nên không còn che Controls/minimap.
    Badge mức lỗi trên node cũng là icon.
  - Sửa lỗi có sẵn: minimap không vẽ node vì kích thước node không được giữ — nay lưu kích thước đo được ở state của canvas
    (không đổi model/command, không vào undo).
  - Script `scripts/editor-screenshots.mjs`.
- Test / cách kiểm tra: `make check` pass (test model/command editor không đổi). Ảnh `29-editor-*`, `30-editor-connect-*`;
  axe-core: 0 vấn đề.
- Còn dở / lỗi đã biết:
  - Thêm thiết bị bằng bàn phím chưa có (chỉ kéo thả); vùng Palette đã cuộn được bằng phím. Làm cùng "/" thêm nhanh (ADR-020, P1-13).
  - Thông báo kiểm tra (validation) sinh trong worker vẫn là tiếng Việt cứng — cần đổi rule trả về key + tham số; làm khi
    editor chuyển sang API (P1-13) để không đổi logic ở bước giao diện.
  - Tên loại thiết bị trong catalog (Router, L2 Switch…) giữ nguyên tiếng Anh (thuật ngữ).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tách bundle theo route.

## 2026-10-16 — UI Bước 3 · trang tổ chức (Dashboard tạm)
- Đã làm: `/o/:orgId` thành Dashboard tạm theo thiết kế: panel Tổ chức (avatar, loại, vai trò, ghi chú; sửa qua dialog,
  409 vẫn giải thích như cũ), panel Tài khoản (MFA bật/tắt — ô mã dùng MfaCodeInput), Đi nhanh tới Thiết bị/Sơ đồ/Thành viên.
  Dashboard đầy đủ để P1-06. KeyValueList thêm `columns={1}` và `wrap`. Không đổi API.
- Test / cách kiểm tra: `make check` pass (test đổi tên tổ chức + 409, vai trò, link bật MFA). Ảnh `07-*`, `28-*`;
  axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: editor sơ đồ (token màu + i18n).

## 2026-10-16 — UI Bước 3 · module Quản trị người dùng + Tình trạng hệ thống
- Đã làm: trang Người dùng (khu vực Hệ thống) trên DataTable, lọc trạng thái/MFA, nhãn System admin cùng màu khu vực hệ thống,
  thao tác trong menu ⋯; vô hiệu hóa và reset MFA qua ConfirmDialog mức 1, link đặt lại mật khẩu trong `OneTimeLinkDialog`
  (ẩn "Vô hiệu hóa" với chính mình — chỉ là gợi ý UI). Trang mới **Hệ thống › Tình trạng hệ thống** (`/admin/health`):
  API, CSDL, phiên bản, môi trường, nút kiểm tra lại — thay cho dòng "API: ok" đã bỏ ở Bước 2. Menu Hệ thống thêm
  "Về tổ chức của tôi". Sửa định dạng giờ thành "09:42 16/10". Không đổi API.
- Test / cách kiểm tra: `make check` pass; test link đặt lại, xác nhận trước khi vô hiệu hóa, health bình thường và CSDL lỗi (503).
  Ảnh `docs/ui-screens/after/13-*, 26-*, 27-*`; axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: trang tổ chức (Tổng quan tạm).

## 2026-10-16 — UI Bước 3 · module Quản trị tổ chức
- Đã làm: trang Tất cả tổ chức (khu vực Hệ thống) — DataTable có avatar tổ chức, lọc theo loại, tạo qua dialog,
  xóa mềm qua ConfirmDialog **mức 2** (gõ đúng tên, liệt kê hậu quả: số thành viên mất quyền, link chia sẻ). Không đổi API.
- Test / cách kiểm tra: `make check` pass; test tạo tổ chức (body gửi đi) và test xóa phải gõ tên mới bật nút.
  Ảnh `docs/ui-screens/after/23..25-*`; axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: module Quản trị người dùng + Tình trạng hệ thống.

## 2026-10-16 — UI Bước 3 · module Thành viên
- Đã làm: trang Thành viên theo thiết kế mới — DataTable (phân trang/sắp xếp phía client qua `useLocalTable`), FilterBar
  (vai trò, trạng thái), mời qua dialog, sửa vai trò + quyền bổ sung trong sheet bên phải, gỡ/rời tổ chức qua ConfirmDialog
  mức 1, link mời một lần trong `OneTimeLinkDialog`. Thêm `NativeSelect`. Nhãn vai trò/quyền chuyển sang i18n.
  Overlay sheet bỏ hiệu ứng làm mờ. Không đổi logic nghiệp vụ hay API (quy tắc ai sửa được ai giữ nguyên).
- Test / cách kiểm tra: `make check` pass; test mời / đổi vai trò + quyền (gửi version) / xác nhận trước khi gỡ / viewer không
  thấy nút quản lý. Ảnh `docs/ui-screens/after/20..22-*`; axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: module Quản trị tổ chức.

## 2026-10-16 — UI Bước 2: nền tảng thiết kế (ADR-024) + trang mẫu
- Đã làm:
  - DESIGN.md cập nhật 10 chỉnh sửa đã duyệt (đánh dấu ✎, §8b); ghi ADR-024; Stack trong CLAUDE.md.
  - Thư viện: @tanstack/react-table (v9), cmdk, sonner, recharts (chưa dùng — cho Dashboard), IBM Plex Sans/Mono (@fontsource),
    react-i18next + i18next, @axe-core/playwright (dev); gỡ Geist. Component shadcn thêm qua CLI rồi chỉnh theo token.
  - API: `Health.environment` (env `NTB_ENV`, mặc định development; Compose mặc định production), `AuthSession.expiresAt`,
    `MfaStatus.verifiedAt` (để SecretField biết MFA quá 5 phút). Có test.
  - Token màu/chữ/mật độ trong `index.css` (Light/Dark/System, Gọn/Thoáng); `cn` cấu hình nhận cỡ chữ token.
  - i18n `src/i18n` (vi mặc định, en; key có kiểm tra kiểu). Component mới không còn chuỗi cứng.
  - Component dùng chung `src/components/`: AppShell (OrgShell + SystemShell có dải màu riêng), sidebar tự thu gọn < 1440px,
    org avatar màu cố định, badge môi trường, breadcrumb, Ctrl+K, thông báo, menu tài khoản (giao diện/mật độ/đăng xuất),
    cảnh báo phiên hết hạn 2 phút; PageHeader, DataTable, FilterBar (+ bộ lọc đã lưu), StatusBadge, KeyValueList, TechText,
    CopyButton, StatCard, EmptyState, ConfirmDialog 2 mức, FormField, PasswordInput, MfaCodeInput, SecretField, Toaster.
  - `/dev/ui` (chỉ dev, đã kiểm tra không có trong bundle production).
  - Trang mới: Danh sách + Chi tiết thiết bị (dữ liệu mẫu "Văn phòng mẫu", giả lập API phân trang server, có banner),
    Đăng nhập, Quên mật khẩu, MFA, Thiết lập MFA (khóa chia nhóm + bước mã khôi phục bắt buộc tick), Kích hoạt, 404.
  - Trang cũ (Dashboard tạm, Thành viên, Quản trị) đã nằm trong khung mới nhưng nội dung chưa làm lại (Bước 3).
    Dòng "API: ok · dev · DB ok" đã bỏ.
- Test / cách kiểm tra:
  - `make check` pass (132 test frontend, gồm test mới cho DataTable/ConfirmDialog/SecretField/MfaCodeInput/hết phiên/Ctrl+K/
    trang thiết bị; đã thử mutation để chắc test bắt lỗi).
  - Ảnh `docs/ui-screens/after/` (15 trang × 1440/1280 × Light/Dark = 60 ảnh).
  - axe-core WCAG 2.1 AA + duyệt Tab 25 bước mỗi trang: `docs/ui-screens/after/a11y-report.md` — 0 vấn đề
    (lần đầu ra 18: tương phản badge trên dòng chọn/Dark, aria-label lệch chữ hiển thị, khung cuộn/tab panel thiếu viền focus — đã sửa).
  - Script: `scripts/screenshots.mjs` (thêm actions/mock), `scripts/a11y.mjs`.
- Còn dở / lỗi đã biết:
  - Thao tác trên trang thiết bị (thêm/sửa/xóa/xuất) chỉ hiện toast "dữ liệu mẫu" cho tới P1-08.
  - Bundle JS ~1 MB (cảnh báo Vite) — tách chunk theo route ở Bước 3.
  - Editor sơ đồ chưa theo token/i18n (Bước 3). Tình trạng hệ thống chưa có trang trong khu vực Hệ thống (Bước 3).
  - API dev đang chạy ở 8069 cần khởi động lại (`make dev-api`) để có `environment`/`expiresAt`.
- Câu hỏi cho người dùng: duyệt ảnh Bước 2 trước khi sang Bước 3.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: UI Bước 3 (làm lại các trang còn lại theo module), sau đó P1-05.

## 2026-10-16 — Thiết kế lại giao diện NMS — Bước 1 (khảo sát & kế hoạch, chưa code giao diện)
- Đã làm: cài `@playwright/test` (trong Stack) + Chromium; `frontend/scripts/screenshots.mjs` (chụp theo danh sách trang, Light/Dark, nhiều độ rộng, cookie session) — dùng lại ở Bước 2–3. Chụp 14 trang × Light/Dark ở 1440px → `docs/ui-screens/before/` (28 ảnh) trên API + Vite riêng (8074/5180) với DB tạm có dữ liệu mẫu và session ở từng trạng thái (đầy đủ, chờ mã MFA, bắt buộc thiết lập MFA); đã dọn DB tạm và process, không đụng server dev 5173/8069 của người dùng. Viết `docs/DESIGN.md`: mục tiêu, 17 vấn đề hiện trạng có dẫn ảnh, bảng màu Light/Dark (accent aqua OM3, nền NOC tối) + 6 màu trạng thái có icon + chữ, typography IBM Plex Sans/Mono đóng gói, thang khoảng cách 4px, mật độ Gọn/Thoáng, AppShell, wireframe 4 kiểu trang, 10 nguyên tắc, thư viện đề xuất, nháp ADR-024.
- Test / cách kiểm tra: tương phản WCAG tính bằng script cho mọi cặp chữ/nền: chữ ≥ 5.06:1 (Light) / ≥ 4.72:1 (Dark); viền control ≥ 3.01:1 (sửa 2 vòng: bản đầu accent/up/warn/unknown Light < 4.5 trên header bảng, viền input < 3:1).
- Còn dở / lỗi đã biết: chưa ghi ADR-024, chưa cài thư viện (chờ duyệt). Thêm `@axe-core/playwright` (dev) vào danh sách đề xuất để kiểm tra AA tự động.
- Câu hỏi cho người dùng: duyệt DESIGN.md (bảng màu, font, mật độ, wireframe, thư viện).
- Đề xuất quyết định cần chốt: ADR-024 Hệ thống thiết kế giao diện (DESIGN.md §10).
- Task tiếp theo đề xuất: Bước 2 — nền tảng + component dùng chung + /dev/ui + 2 trang mẫu (sau khi duyệt).

## 2026-10-16 — P1-04 Người dùng & vai trò
- Đã làm:
  - Migration `000005_user_tokens` (link dùng 1 lần: invite / password_reset, chỉ lưu SHA-256). User được mời có `password_hash = ''` → đăng nhập luôn bị từ chối (sửa luôn: trước đó hash rỗng làm Login lỗi 500).
  - API (OpenAPI trước): `/orgs/{orgId}/members` GET (mọi thành viên) / POST (thêm theo email: user có sẵn → thêm ngay; chưa có → tạo user chờ + link mời 7 ngày) / PATCH `{userId}` (vai trò + quyền bổ sung, optimistic lock 409) / DELETE (gỡ; ai cũng tự rời được) / POST `{userId}/invite` (cấp lại link, link cũ hết hiệu lực); `/account-tokens/{token}` GET/POST công khai (xem link / đặt mật khẩu → dùng 1 lần, đăng xuất mọi nơi); `/admin/users` GET + `{userId}/disable|enable|reset-mfa|password-reset` (system admin).
  - Quy tắc vai trò (`checkRoleChange`): quản lý thành viên = owner/admin/`user.manage`; chỉ owner cấp/đổi/gỡ owner; chỉ owner/admin cấp/đổi admin và quyền bổ sung; không gỡ/hạ owner cuối cùng (409). `credential.reveal` ⇒ bắt buộc MFA (GetSession + UserRequiresMFA).
  - Bảo mật: reset mật khẩu / reset MFA chỉ system admin (admin tổ chức reset user thuộc nhiều tổ chức = chiếm quyền tổ chức khác); **chặn tấn công link mời chéo tổ chức**: không thêm được user đang chờ kích hoạt thuộc tổ chức khác (409), chỉ cấp lại link khi user chỉ thuộc đúng tổ chức này. System admin không tự vô hiệu hóa, không vô hiệu hóa system admin cuối; vô hiệu hóa / reset MFA đăng xuất user ngay. Audit: member.add/update/remove/invite_regenerated, user.disable/enable/mfa_reset/password_reset_issued, account.invite_accepted/password_reset.
  - Frontend: `/o/:orgId/members` (danh sách, thêm + hiện link mời 1 lần, đổi vai trò/quyền theo đúng quy tắc, gỡ/rời, cấp lại link), `/invite/:token` công khai (kích hoạt / đặt lại mật khẩu, nhập lại mật khẩu), `/admin/users` (vô hiệu hóa, reset MFA, link đặt lại mật khẩu).
- Test / cách kiểm tra: unit 11 trường hợp quy tắc vai trò; API với Postgres thật: cách ly mọi endpoint thành viên (kể cả nhắm user tổ chức khác qua đường dẫn tổ chức mình), mời → xem → mật khẩu yếu 400 → đăng nhập trước khi kích hoạt bị từ chối → kích hoạt → dùng lại link 404 → đăng nhập; thêm user có sẵn / trùng (không phân biệt hoa thường) 409 / dữ liệu sai 400; kịch bản tấn công link mời chéo tổ chức 409; quy tắc vai trò + owner cuối + version cũ + tự rời; credential.reveal → MFA bắt buộc; cấp lại link; quản trị user (owner bị 403, tự vô hiệu hóa 409, session mất sau khi vô hiệu hóa/reset MFA, link đặt lại mật khẩu dùng được) + audit. Mutation check: bỏ chốt chặn link mời → test tấn công fail. Vitest 110 (6 mới). Chạy thật process API + DB tạm (đã xóa) với Origin: owner mời → người được mời kích hoạt → đăng nhập thấy tổ chức (editor). Migration 5 đã áp vào DB dev. `make check` pass.
- Còn dở / lỗi đã biết: giới hạn theo site chuyển sang P1-07 (đã ghi vào PLAN); chưa gửi email (link copy tay tới P2-05 SMTP); thêm user có sẵn tiết lộ email đó có tài khoản trong hệ thống (rủi ro nhỏ, chấp nhận); chưa có trang "tài khoản của tôi" để tự đổi mật khẩu (P1-06 app shell).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-05 Audit log (màn hình xem/lọc audit; ghi trước/sau đã có từ P1-03).

## 2026-10-16 — P1-03 Tổ chức & tenant middleware
- Đã làm:
  - ADR-023 (người dùng chốt): tổ chức xác định theo đường dẫn `/api/orgs/{orgId}/…` (web `/o/{orgId}`); system admin không mặc nhiên đọc dữ liệu tổ chức không phải thành viên.
  - `internal/tenant`: middleware tách `orgId` từ path (chỉ nhận UUID chuẩn), kiểm tra membership mỗi request; không phải thành viên / không tồn tại / đã xóa mềm → **404** giống nhau; `Membership` (CanEdit/CanAdmin/Has) trong context; `tenant.Require(ctx, orgId)` đối chiếu path param với context (lớp phòng thủ thứ hai).
  - `internal/audit`: ghi audit dùng chung (before/after JSON), gọi trong cùng transaction với thao tác ghi; `auth` chuyển sang dùng.
  - API: `GET /orgs` (tổ chức của tôi), `GET/PATCH /orgs/{orgId}` (PATCH: owner/admin, optimistic lock `version` → 409, audit `organization.update`), `POST /orgs/{orgId}/activate` (tổ chức mặc định, `AuthSession.activeOrganizationId`), `/admin/organizations` GET/POST (+`addMeAsOwner`, mặc định true) và DELETE (xóa mềm) — gate `requireSystemAdmin`; audit `organization.create/delete`.
  - `internal/tenanttest`: bộ test chống truy cập chéo dùng lại — Fixture 2 tổ chức + owner mỗi bên (session đã xác thực MFA), `NewUser` theo vai trò, `AssertCrossTenantDenied` (A gọi tài nguyên B → 404, kèm request đối chứng của B).
  - Frontend: `/` chuyển tới tổ chức dùng gần nhất / đầu tiên / thông báo chưa có tổ chức; `/o/:orgId` (bộ chọn tổ chức, thông tin + sửa cho owner/admin, báo 409, trang "không tìm thấy"); `/admin/organizations` (danh sách, tạo, xóa có xác nhận). `errorMessage`/`csrfParam` dùng chung trong `api/client.ts`.
- Test / cách kiểm tra: tenant unit (parse path, middleware, vai trò, Require); API với Postgres thật: cách ly mọi endpoint tổ chức + dữ liệu B không đổi + tổ chức không tồn tại/xóa mềm → 404; danh sách theo membership; viewer/editor PATCH → 403 ở backend; tên trống 400; version cũ 409; audit đúng 1 dòng có before/after; activate; admin gate 403 với owner; system admin không đọc được tổ chức không phải thành viên; tạo/xóa + audit. **Mutation check**: gỡ middleware tenant → test cách ly fail. Vitest 104 (6 test mới). Chạy thật process API + DB tạm (đã xóa) với header Origin: tạo 2 tổ chức → /orgs chỉ thấy tổ chức là owner → tổ chức kia 404 → PATCH 200 rồi version cũ 409 → audit đủ. `make check` pass.
- Còn dở / lỗi đã biết: chưa có thêm thành viên vào tổ chức có sẵn (P1-04); system admin tạo tổ chức với "không thêm tôi" thì chưa ai vào được cho tới P1-04; `site_scope` mới lưu, chưa áp dụng (khi có sites P1-07); editor `/editor` chưa gắn tổ chức (P1-13). Server `make dev-api` đang chạy của người dùng là bản cũ — cần khởi động lại.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-04 Người dùng & vai trò.

## 2026-10-16 — Sửa lỗi: đăng nhập qua Vite (5173) bị chặn CSRF
- Đã làm: proxy Vite viết dạng rút gọn `'/api': url` ngầm bật `changeOrigin: true` → đổi Host thành `localhost:8069`, khác `Origin: http://localhost:5173` của trình duyệt → `csrfGuard` chặn mọi lần đăng nhập ở cổng dev. Đổi sang dạng object với `changeOrigin: false` (giống nginx `$http_host`).
- Test / cách kiểm tra: tái hiện bằng curl có header `Origin: http://localhost:5173` qua Vite → trước 403, sau 401 (đúng: tài khoản giả); Origin lạ vẫn 403; Docker 8068 vẫn đúng. `make check` pass. Bài học: kiểm tra trọn luồng phải gửi header `Origin` như trình duyệt (các lần trước dùng curl không có Origin nên không lộ lỗi).
- Còn dở / lỗi đã biết: dòng "401 (Unauthorized)" trong console khi mở trang là bình thường — frontend gọi `/auth/me` để biết đã đăng nhập chưa; trình duyệt luôn ghi log mọi phản hồi 4xx.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Tổ chức & tenant middleware.

## 2026-10-16 — P1-02 MFA TOTP
- Đã làm:
  - `internal/secrets`: mã hóa envelope — mỗi bí mật một DEK (AES-256-GCM), DEK bọc bằng master key (AES-256-GCM), lưu `key_version` để xoay key sau (ADR-018); AAD gắn bí mật vào ngữ cảnh (`totp:<user id>`) nên chép sang dòng khác không giải mã được. Dùng lại cho kho mật khẩu Phase 2.
  - `NTB_MASTER_KEY` **bắt buộc**: API không khởi động nếu thiếu/sai (base64 32 byte). Compose báo lỗi nếu chưa đặt; `make dev-env` tạo `deploy/.env` (chmod 600, key ngẫu nhiên) — đã tạo cho máy người dùng; `make dev-api` đọc cùng key đó (dev và Docker dùng chung DB nên phải chung key); không còn key nào commit trong repo.
  - Migration `000004_mfa`: `mfa_totp` (seed mã hóa, `enabled_at`, `last_used_step` chống dùng lại mã), `mfa_recovery_codes` (chỉ SHA-256). Query sqlc `mfa.sql`; `GetSession` trả thêm trạng thái MFA (enabled / verified / required = system admin hoặc owner/admin ở bất kỳ tổ chức nào).
  - `auth`: SetupTOTP (pquerna/otp, QR PNG sinh ở backend), EnableTOTP (transaction: bật + 10 mã khôi phục + đánh dấu session), VerifyMFA (TOTP ±1 bước, claim bước nguyên tử chống replay; hoặc mã khôi phục dùng 1 lần, gõ thường/không gạch vẫn nhận), DisableTOTP (cần mã mới; cấm khi bắt buộc), rate limit verify 5/phút/user; audit `mfa.setup/enable/enable_failed/verify/verify_failed/recovery_code_used/disable/disable_failed/verify_rate_limited`.
  - API: `POST /auth/mfa/{setup,enable,verify,disable}`; `AuthSession.mfa`. Middleware `mfaGate`: session chưa xong MFA chỉ gọi được me/logout/verify (hoặc setup/enable nếu bắt buộc thiết lập) — module sau tự được bảo vệ.
  - Frontend: `/mfa` (mã TOTP hoặc mã khôi phục), `/mfa/setup` (QR, khóa nhập tay, xác nhận, hiện mã khôi phục 1 lần + sao chép/tải .txt), guard điều hướng theo trạng thái MFA, trang chủ bật/tắt MFA cho người không bắt buộc.
  - Lỗi bắt được nhờ test: SetupTOTP với trạng thái session cũ trả QR cho seed không được lưu (UPSERT bỏ qua âm thầm) → giờ dựa vào số dòng DB ghi được, trả 409.
- Test / cách kiểm tra: secrets 4 test; auth thêm 4 test MFA với Postgres thật (trọn luồng + seed không lưu bản rõ + replay + mã khôi phục 1 lần + tắt; bắt buộc với system admin; rate limit; seed gắn với user); router thêm 2 test gate (admin bị buộc thiết lập; session chờ mã bị chặn). Vitest 98 (4 test MFA mới). Chạy thật với DB tạm (đã xóa): thiếu/sai key → API từ chối khởi động; admin → setup → bật bằng mã TOTP thật (tính độc lập bằng Python) → login mới bị chặn setup (403) → replay 401 → mã bước kế tiếp OK; audit đúng thứ tự. Docker build lại, migration 4 tự áp. `make check` pass.
- Còn dở / lỗi đã biết: chưa có trang "Tài khoản" đầy đủ (bật/tắt MFA tạm ở trang chủ, app shell P1-06); chưa có xoay master key (Phase 2, cấu trúc đã sẵn `key_version`); đặt lại MFA khi mất cả điện thoại lẫn mã khôi phục cần admin (P1-04 quản lý user). Trong lúc kiểm tra tôi đã tắt tiến trình `make dev-api` đang chạy ở 8069 (bản cũ) — người dùng cần chạy lại.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Tổ chức & tenant middleware.

## 2026-10-16 — ADR-022 Xóa mềm + ẩn mật khẩu CLI
- Đã làm:
  - ADR-022 (người dùng chốt): user/tổ chức không xóa cứng khi có dữ liệu liên quan — xóa mềm qua `users.disabled_at` / `organizations.deleted_at`; thêm `golang.org/x/term` vào Stack (CLAUDE.md cập nhật).
  - Migration `000003_soft_delete`: FK `audit_log` → users/organizations đổi `ON DELETE SET NULL` → `RESTRICT` (sửa lỗi P0-04: SET NULL đụng trigger append-only); thêm `organizations.deleted_at`.
  - `ntb admin create`: trên terminal gõ mật khẩu ẩn + nhập lại xác nhận; stdin là pipe/file thì đọc 1 dòng như cũ.
- Test / cách kiểm tra: test DB mới — xóa cứng user/tổ chức có audit → lỗi FK 23503 rõ ràng, user không liên quan xóa được, xóa mềm hoạt động; test auth — user bị vô hiệu hóa mất session và không đăng nhập được. Migration 000003 down/up chạy được; CLI kiểu pipe chạy thật trên DB tạm (đã xóa) và xóa cứng user đó bị chặn bởi `audit_log_actor_user_id_fkey`. `make check` pass. Docker api build lại, migration tự áp.
- Còn dở / lỗi đã biết: chế độ gõ ẩn cần terminal thật — chưa kiểm tra tự động, nhờ người dùng thử tay. Các truy vấn danh sách tổ chức (P1-03) phải lọc `deleted_at IS NULL`.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-02 MFA TOTP.

## 2026-10-16 — P1-01 Đăng nhập (+ tick P0-05)
- Đã làm:
  - Migration `000002_session_csrf` (csrf_token theo session). Query sqlc `auth.sql` (user, lockout, session, audit).
  - `internal/auth`: argon2id PHC (m=64MiB,t=3,p=2; so sánh constant-time; email lạ vẫn băm giả chống dò thời gian); token 32 byte, DB chỉ lưu SHA-256; session idle 12h / tối đa 7 ngày, gia hạn trượt (ghi DB tối đa 5 phút/lần); khóa 15 phút sau 5 lần sai; rate limit bộ nhớ 10/phút/IP + 5/phút/email (429); `ClientIPResolver` chỉ tin X-Forwarded-For từ `NTB_TRUSTED_PROXIES` và lấy hop không tin cậy ngoài cùng bên phải; audit `auth.login` / `auth.login_failed` / `auth.login_rate_limited` / `auth.logout` / `user.create` (email chuẩn, không bao giờ có mật khẩu).
  - API (OpenAPI trước): `POST /auth/login` (Set-Cookie `ntb_session` HttpOnly, SameSite=Lax, Secure khi HTTPS qua proxy tin cậy), `POST /auth/logout`, `GET /auth/me` (user + CSRF token). Middleware: request info, nạp session, `csrfGuard` (chặn Sec-Fetch-Site cross-site / Origin≠Host cho mọi request ghi — chặn cả login CSRF; request đã đăng nhập phải có X-CSRF-Token đúng). Lỗi 400/500 trả thông báo chung, không lộ chi tiết nội bộ. Job xóa session hết hạn mỗi giờ.
  - CLI `ntb admin create --email --name` (mật khẩu từ stdin, ≥ 12 ký tự).
  - Frontend: `/login` (form, hiện lỗi server, `?next=` chỉ nhận đường dẫn nội bộ — chặn open redirect), `RequireAuth` cho `/` và `/editor`, client openapi-fetch tự gắn X-CSRF-Token, nút Đăng xuất.
  - Deploy: nginx giữ cổng trong Host (`$http_host`) để kiểm tra Origin khớp; Compose tạo mạng riêng 172.30.68.0/24, nginx IP tĩnh 172.30.68.10 và API **chỉ tin đúng IP đó** (bản đầu tin cả 192.168.0.0/16 — máy LAN có thể giả IP vượt rate limit; đã phát hiện khi kiểm tra và sửa). Docker image build dùng golang:1.27 (go.mod tối thiểu 1.26 do x/crypto).
- Test / cách kiểm tra:
  - Go: 15 test auth (băm, token, IP resolver chống giả mạo, rate limit, khóa tạm + mở khóa, rate limit theo email, vòng đời session, không lưu token gốc, session hết hạn, mật khẩu ngắn, audit không chứa mật khẩu + dùng email chuẩn) + 8 test HTTP (login sai/đúng + thuộc tính cookie, /me, logout thiếu/sai/đúng CSRF, chặn cross-origin, body hỏng 400 không lộ nội bộ, healthz). Vitest 8 test (guard, login, lỗi, chặn open redirect, logout gửi CSRF).
  - Chạy thật với DB tạm `ntb_e2e` (đã xóa): CLI tạo admin → login sai 401 → đúng 200 + cookie → /me → logout thiếu CSRF 403 / có CSRF 204 → /me 401; audit đủ 4 sự kiện.
  - Docker 8068: `/login` hiển thị trang đăng nhập (Done khi P0-05 ✅), migration 000002 tự chạy, login cùng nguồn gốc 401 / khác nguồn gốc 403, X-Forwarded-For giả bị bỏ qua. `make check` pass.
- Còn dở / lỗi đã biết:
  - **Lỗi thiết kế ở migration P0-04:** khóa ngoại `audit_log` dùng ON DELETE SET NULL nhưng trigger append-only chặn UPDATE → user/tổ chức đã có audit thì không xóa được (lỗi khó hiểu). Cần chốt hướng sửa (xem câu hỏi).
  - Docker Desktop (Mac) hiển thị mọi client là gateway 172.30.68.1 → rate limit theo IP gộp chung mọi người dùng khi chạy Docker trên Mac; server Linux giữ IP thật.
  - `ntb admin create` gõ tay thì mật khẩu hiện trên màn hình (không ẩn) — ẩn cần `golang.org/x/term` (ngoài Stack).
  - Rate limit trong bộ nhớ, reset khi restart (phù hợp 1 binary).
- Câu hỏi cho người dùng: (1) Sửa xung đột audit_log: (a) không bao giờ xóa cứng user/tổ chức, chỉ vô hiệu hóa (`disabled_at`), đổi FK thành RESTRICT; hay (b) bỏ FK của audit_log, giữ actor_user_id + email như dữ liệu lịch sử? (2) Cho thêm `golang.org/x/term` để ẩn mật khẩu khi gõ ở CLI?
- Task tiếp theo đề xuất: P1-02 MFA TOTP (cần chốt câu hỏi 1 trước khi đụng tới user/tổ chức ở P1-03/P1-04).

## 2026-10-16 — P0-05 Compose đầy đủ (hạ tầng xong, CHƯA tick)
- Đã làm:
  - `deploy/api.Dockerfile`: build Go nhiều tầng (golang:1.25-alpine, CGO tắt, GOWORK=off) → alpine, chạy user không root (uid 10001).
  - Compose: service `api` (env `NTB_DATABASE_URL` trỏ `db`, `NTB_MIGRATE_ON_START=true`, `NTB_MASTER_KEY`), healthcheck cả `web`/`api`/`db` (healthcheck api gọi `/api/healthz` → bao luôn kết nối DB); thứ tự khởi động db → api → web theo healthy.
  - Backend: cờ `NTB_MIGRATE_ON_START` (config + test) — API tự chạy migration nhúng trước khi phục vụ; dev vẫn dùng `make migrate-up`.
  - nginx: `location /api/` proxy sang `api:8069` (đặt trước SPA fallback, kèm X-Forwarded-*); route /api sai trả 404 thay vì `index.html`.
  - `.env.example`: `NTB_MASTER_KEY` (hướng dẫn `openssl rand -base64 32`, cảnh báo giữ riêng khỏi backup), `NTB_VERSION`, lưu ý ký tự đặc biệt trong mật khẩu DB.
  - Thêm `.dockerignore` (node_modules macOS từng có thể ghi đè node_modules Linux do `COPY frontend/` sau `npm ci`).
  - Sửa lỗi có sẵn: build Docker `web` hỏng từ P1-10 cũ vì frontend import `../schema` (alias @schema) mà Dockerfile chỉ copy `frontend/` → build giữ bố cục `/repo/frontend` + `/repo/schema`.
- Test / cách kiểm tra (chạy thật): `docker compose -f deploy/docker-compose.yml up -d --build` → 3 service healthy; `curl :8068/api/healthz` → 200 JSON `database:ok`; `/api/nope` → 404 (không phải index.html); `/editor` → 200; bundle đúng bản mới; log api có "applying database migrations"; `id` trong container = uid 10001. `make check` pass.
- Còn dở / lỗi đã biết: **P0-05 chưa tick** — Done khi cần "thấy trang đăng nhập", trang đó thuộc P1-01; tick cùng P1-01. Chưa thử migrate trên volume DB trống (không xóa volume dev của người dùng; logic migrate đã có test Go với DB tạm). API chưa dùng `NTB_MASTER_KEY` (từ P1-02) — sẽ bắt buộc có giá trị khi khởi động lúc đó.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-01 Đăng nhập (argon2id, session cookie Postgres, logout, khóa tạm, CSRF, rate limit, IP client sau proxy tin cậy, `ntb admin create`, trang đăng nhập) — xong thì tick luôn P0-05.

## 2026-10-16 — P0-03 Sinh code
- Đã làm:
  - **OpenAPI 3.1 khả thi:** thử thật oapi-codegen v2.8.0 với spec 3.1 (`type: [string, "null"]` → `*string`) — chạy đúng. `api/openapi.yaml` nâng lên 3.1.0 theo đúng ADR-017, không cần ADR mới.
  - oapi-codegen ghim phiên bản bằng `go get -tool` (chạy `go tool oapi-codegen`), strict-server + chi + models → `internal/api/apigen`. sqlc (brew) với schema lấy từ migrations → `internal/store` (pgx/v5, có interface Querier). openapi-typescript + openapi-fetch → `frontend/src/api/{schema.d.ts,client.ts}`.
  - `make gen` chạy cả 3. Endpoint mẫu trọn đường: `GET /api/healthz` → `Server.GetHealthz` (implement StrictServerInterface) → sqlc `Ping` → Postgres; trả 200 `{status:ok, database:ok}` hoặc 503 `{status:degraded, database:unavailable}`; frontend dùng client sinh code (`api.GET('/healthz')`).
  - API kết nối DB qua `NTB_DATABASE_URL` (mặc định DB dev 5468); pool lazy — API vẫn chạy khi DB tắt và healthz báo.
  - openapi-typescript 7.13.0 (bản mới nhất) chỉ khai báo peer TypeScript ^5, dự án dùng TS 6 → thêm `overrides` trong `frontend/package.json` cho nó dùng TS của dự án; đã kiểm tra output đúng (chỉ là công cụ sinh code lúc dev).
  - openapi-fetch: `baseUrl` tuyệt đối theo origin trang (Request ngoài trình duyệt không nhận URL tương đối) và tra `fetch` mỗi lần gọi (test stub được).
- Test / cách kiểm tra (chạy thật): `make dev-api` + `make dev-web`, `curl :5173/api/healthz` → 200 database ok; dừng container db → 503 degraded (Done khi ✅). Go: healthz ok / DB lỗi 503 / **trọn đường với Postgres thật qua sqlc** / 404. Vitest: client sinh code gọi đúng `/api/healthz`, hiển thị ok / degraded / lỗi mạng. `make check` pass (90 FE test).
- Còn dở / lỗi đã biết: chưa có kiểm tra tự động "code sinh ra đã cập nhật" (chạy `make gen` rồi `git diff --exit-code`) — đề xuất thêm khi có CI. API chưa tự chạy migration khi khởi động (quyết định ở P0-05 cho container `api`).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P0-05 Compose đầy đủ (`api` container, nginx proxy `/api`, healthcheck, migration khi khởi động, `NTB_MASTER_KEY` trong `.env.example`).

## 2026-10-16 — P0-04 Database
- Đã làm:
  - Migration `000001_init`: `organizations` (kind internal/customer), `users` (email citext unique, password_hash, is_system_admin, khóa tạm), `memberships` (role owner/admin/editor/viewer, permissions giới hạn theo ADR-019, site_scope, unique org+user), `sessions` (chỉ lưu hash token, active_organization_id, mfa_verified_at), `audit_log` (before/after JSONB, ip, request_id; **append-only bằng trigger** — UPDATE/DELETE bị chặn ở DB). Trigger `set_updated_at`; cột `version` cho optimistic lock.
  - `backend/db/embed.go` (migration nhúng vào binary), `internal/database` (pgxpool Open + MigrateUp/Down qua golang-migrate pgx5 driver), `internal/testdb` (mỗi test tạo DB tạm `ntb_test_<random>`, migrate, DROP khi xong).
  - Compose: `db` mở cổng host **5468** (máy có Postgres riêng ở 5432), chỉ bind 127.0.0.1; `.env.example` thêm `DB_PORT`. Makefile: `db-up`, `migrate-up/down` (CLI golang-migrate), `DATABASE_URL` + `NTB_TEST_DATABASE_URL` mặc định trỏ DB dev.
  - `go.work` ở gốc repo (gopls trong IDE nhận module backend).
- Test / cách kiểm tra (chạy thật): `make migrate-up` tạo 5 bảng → `make migrate-down` xóa sạch → `migrate-up` lại OK (Done khi ✅). Go test với Postgres thật: kết nối + đủ bảng, down/up round-trip, ràng buộc (email trùng không phân biệt hoa thường, role sai, membership trùng, permission lạ, trigger updated_at, audit_log không sửa/xóa được). Không còn DB tạm sau test. `make check` pass.
- Còn dở / lỗi đã biết: `make check` giờ cần `make db-up` trước (test DB fail rõ ràng nếu DB không chạy; chỉ skip khi biến `NTB_TEST_DATABASE_URL` rỗng). `brew install golang-migrate` tự nâng Go trên máy lên 1.27.2; `go.mod` tối thiểu go 1.25.11 (do pgx/migrate). API chưa kết nối DB (làm khi có endpoint dùng DB).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P0-03 Sinh code (oapi-codegen + openapi-typescript/openapi-fetch + sqlc, endpoint mẫu trọn đường) — kèm kiểm tra OpenAPI 3.1 vs 3.0.3.

## 2026-10-16 — Refactor theo PLAN v2: dọn dẹp, cấu trúc lại, P0-01 Khung monorepo
- Đã làm:
  - Dọn dẹp: chuyển `dexie`/`fake-indexeddb` khỏi `package.json` gốc repo (lỗi cũ); ADR-021 (giữ oxlint, cổng web 8068), tick P0-02.
  - Cấu trúc lại: `src/{model,canvas,panels,validation,catalog,io}` → `src/editor/*`; gỡ autosave cả tài liệu + khôi phục phiên + Save/Open file làm lưu chính (ADR-015); giữ đọc/validate `.ntb.json` cho P1-22; gỡ dexie/fake-indexeddb (cài lại ở P1-13).
  - P0-01: backend chi + `GET /api/healthz` (`internal/api`), config env (`internal/config`, `NTB_HTTP_ADDR` mặc định `:8069`), slog JSON request log, graceful shutdown; `api/openapi.yaml` tối thiểu; frontend react-router (`/` trang tạm gọi healthz qua TanStack Query, `/editor` editor hiện có) + proxy Vite `/api` → `:8069`.
  - Bỏ `middleware.RealIP` của chi (staticcheck báo deprecated: giả mạo IP qua X-Forwarded-For) — lấy IP client sau proxy tin cậy sẽ làm ở P1-01.
- Test / cách kiểm tra: chạy thật `make dev-api` + `make dev-web` → `curl localhost:5173/api/healthz` trả `{"status":"ok","version":"dev"}` HTTP 200 qua proxy (Done khi P0-01 ✅). Go test healthz + 404; Vitest: home hiện trạng thái API / báo lỗi khi API sập / route editor render canvas. `make check` pass (89 FE test). ✅
- Còn dở / lỗi đã biết: `api/openapi.yaml` tạm viết OpenAPI **3.0.3** (ADR-017 ghi 3.1) — sẽ kiểm tra oapi-codegen ở P0-03, nếu hỗ trợ 3.1 thì nâng, nếu không thì ghi ADR. `/editor` vẫn chạy trên store client (`useEnsurePage`, tạo device phía client) cho tới P1-13/P1-15. IDE báo gopls thiếu `go.work` (không ảnh hưởng build).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: OpenAPI 3.0.3 vs 3.1 (sau khi kiểm tra ở P0-03).
- Task tiếp theo đề xuất: P0-04 Database (migration + golang-migrate) trước P0-03 vì sqlc cần schema DB.

## 2026-10-16 — Chuyển sang SRS v2.0
- Đã làm: áp dụng CLAUDE.md mới, SRS v2.0, DECISIONS hợp nhất (ADR-001..020), PLAN v2. Đối chiếu code hiện có với PLAN v2 (chưa sửa code).
  Mọi task "P1-xx" ở các mục STATUS bên dưới là ID của PLAN v1, không trùng nghĩa với ID PLAN v2.
- Test / cách kiểm tra (chạy thật):
  - `make check` exit 0 (89 test FE, Go round-trip, oxlint + golangci-lint 0 issues).
  - P0-01: CHƯA đạt — `make dev-api` chỉ in "ok" rồi thoát; chưa có chi, `/healthz`, proxy Vite, `api/openapi.yaml`, react-router, TanStack Query.
  - P0-02: đạt về chức năng nhưng dùng oxlint (người dùng chốt ở phiên P0-02 cũ), PLAN v2 ghi ESLint → chưa tick, chờ chốt.
  - P0-03: CHƯA (chưa có oapi-codegen / openapi-typescript / sqlc). P0-04: một phần (db trong Compose, chưa có migration). P0-05: một phần (web + db, chưa có api; cổng đang là 8068 vì 8080 bị trùng, PLAN v2 ghi 8080).
  - Kết quả: không tick task nào trong PLAN v2.
- Code dùng lại được (ứng với PLAN v2):
  - Khung frontend Vite + React 19 + TS strict + Tailwind + shadcn/ui → P0-01 (thiếu router/TanStack Query).
  - Lint/format/test + `make check`, golangci-lint → P0-02. Dockerfile web, nginx.conf, service db → P0-04/P0-05.
  - Editor: store + commands + undo/redo (snapshot Immer, mergeKey, compound) → P1-13; CanvasView/DeviceNode/adapters → P1-14;
    catalog template + icon + generateInterfaces, Palette → P1-09/P1-15; chọn/copy/paste/duplicate/lock/phím tắt → P1-16;
    LinkDialog + ports.ts + edge style + link song song → P1-17; Sidebar, label template, LinkEdge, tooltip → P1-18;
    rule engine + Web Worker + Problems + badge + cidr helpers → P1-20; schema + ajv + Go round-trip → P1-22 (.ntb.json).
- Phải sửa:
  - Model editor: `NtbData` (cả tài liệu trong client) → view của diagram + tham chiếu thực thể kho lấy qua API; command sinh change set (view + kho) để lưu 1 request/1 transaction (P1-13).
  - Schema/types: mgmtIp → mgmt_interface_id; interface `kind`; ip_addresses (vrf, role); lifecycle mới (planned/active/spare/rma/retired); site/location, part number, S/N, managed; link endpoint a_kind/b_kind, interface null; endpoint_groups, ip_ranges; view node refKind. Go `internal/model` thành DTO export/import.
  - Hành vi: Delete chỉ gỡ khỏi sơ đồ, Shift+Delete xóa khỏi kho (hiện `deleteDevice` cascade xóa kho); `addLink` cho phép interface null, chặn link vật lý vào interface ảo; trùng hostname theo tổ chức + trùng S/N.
  - Cấu trúc thư mục: `src/model|canvas|panels|validation|io` → `src/editor/...`, `src/app`, `src/modules`, `src/api`.
  - Makefile: `make types` → `make gen`; migrate targets thật. Compose thêm `api` + proxy `/api`.
  - LỖI CỦA TÔI (P1-10 v1): `dexie` + `fake-indexeddb` cài nhầm vào `package.json` ở gốc repo (sai thư mục) và đã commit; phải chuyển vào `frontend/` và xóa `package.json`/`package-lock.json`/`node_modules` ở gốc.
- Nên bỏ: autosave cả tài liệu vào IndexedDB + khôi phục phiên (`useAutosave`, session `replaceDocument`) — ADR-015 chỉ giữ nháp chưa gửi;
  Save/Open file làm lưu chính (Ctrl+S nay là lưu lên server; logic file chuyển sang export/import P1-22); `useEnsurePage` tự tạo page; tạo device thuần client (`deviceDropCommand`, hostname tự sinh phía client) — tạo thiết bị phải qua API/change set; layout App 3 cột hiện tại → app shell có router.
- Còn dở / lỗi đã biết: file `ntb-v2.zip` (bản gốc 4 tài liệu) nằm chưa track ở gốc repo — không commit, đề xuất xóa hoặc thêm vào .gitignore.
- Câu hỏi cho người dùng: (1) giữ oxlint (ghi ADR mới) hay đổi sang ESLint? (2) cổng web 8080 (theo PLAN) hay 8068 (đang dùng vì trùng cổng)? (3) cho phép cài tool CLI: oapi-codegen, sqlc, golang-migrate (go install/brew)?
- Đề xuất quyết định cần chốt: oapi-codegen chưa hỗ trợ đầy đủ OpenAPI 3.1 (ADR-017 ghi 3.1) — cần kiểm tra phiên bản; nếu không ổn thì viết spec 3.0.3 và ghi ADR.
- Task tiếp theo đề xuất: dọn dẹp (package.json gốc, zip, chốt lint/cổng) → P0-01 → P0-04 → P0-03 → P0-05 (đổi chỗ 03/04 vì sqlc cần migration có sẵn).

## 2026-10-16 — P1-10 Lưu trữ
- Đã làm:
  - Thêm deps: `dexie` (Stack), `fake-indexeddb` (dev, test IndexedDB).
  - `src/io/autosave.ts`: Dexie DB `ntb`, bảng `sessions` (1 dòng `current`), `saveSession/loadSession/clearSession`; dirty tracking module-level (`isDirty`/`markSaved`).
  - `src/io/useAutosave.ts`: autosave 30 s sau lần thay đổi cuối, flush khi `pagehide`, cảnh báo `beforeunload` khi chưa flush, khôi phục phiên lúc mở app (chỉ khi document còn trống và session không rỗng).
  - `src/io/schemaValidate.ts`: compile schema bằng ajv (alias `@schema` mới — vite/vitest/tsconfig, vì schema nằm ngoài frontend root; thêm `resolveJsonModule`).
  - `src/io/file.ts`: `downloadProjectFile` (tải `.ntb.json`, tên theo project.name), `readProjectFile` (JSON.parse → ajv validate → fromNtbProjectFile, lỗi có thông báo tiếng Việt).
  - Lệnh `replaceDocument` (load file / restore = 1 bước undo). Toolbar: nút Open (file input ẩn) + Save; **Ctrl+S** lưu file + refresh autosave (SRS §3).
- Test / cách kiểm tra: 89/89 pass (7 test mới) — **Done khi: Save → Load deep-equal** cho cả round-trip file lẫn session IndexedDB (fake-indexeddb); validate schema chặn file hỏng; replaceDocument 1 bước undo. `make check` pass. ✅
- Còn dở / lỗi đã biết: IndexedDB là theo origin — dữ liệu dev (5173) và Docker (8068) khác nhau; autosave chưa hiện trạng thái "đã lưu lúc…" trên UI (có thể thêm nhỏ ở P1-12).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-11 Export PNG (1x–4x, nền trong suốt/trắng) và SVG, có legend.

## 2026-10-15 — P1-09 Validation
- Đã làm:
  - `src/validation/cidr.ts`: parse strict IPv4 CIDR (network/broadcast/contains/networkKey). Bài học: `ipaddr.IPv4.subnetMask` không tồn tại ở ESM build → tự tính mask từ prefix; `parsed.octets` cần cast vì type union IPv4|IPv6.
  - `src/validation/rules.ts`: 8 rule MVP SRS §6 — R1 IP sai định dạng/network/broadcast (Error), R2 trùng IP cùng VRF (Error), R3 trùng hostname (Error), R4 1 cổng > 1 link (Error), R5 sai loại cổng RJ45↔SFP (Warning), R6 gateway ngoài subnet (Warning), R7 2 đầu link L3 khác subnet (Warning), R8 thiết bị không link (Info); `severityForDevice` cho badge.
  - `engine.ts` (gộp rule) + `worker.ts` (Web Worker, Vite `new URL` module worker) + `useValidation` hook (debounce 300 ms, fallback chạy sync khi không có Worker — jsdom).
  - Store: `problems`, `focusTarget` (nonce để click lặp lại vẫn re-zoom). `Problems.tsx`: panel đáy canvas, đếm theo severity, click → zoom tới node (`setCenter`) hoặc fitView 2 đầu link. `DeviceNode`: badge màu theo severity nặng nhất (đỏ/vàng/xanh).
  - `testdata/sample-small.ntb.json`: thêm cổng SFP uplink cho 2 access switch và cổng X1/X2 SFP+ cho firewall FG-100F (2 link cũ rj45↔sfp_plus sai thực tế) — file mẫu giờ validate sạch.
- Test / cách kiểm tra: 82/82 pass — mỗi rule có test đúng + sai (tiêu chí "Done khi"), test cidr helpers, engine tổng hợp, **file mẫu phải sạch hoàn toàn**. `make check` pass. ✅
- Còn dở / lỗi đã biết: chưa test chính Web Worker (chạy browser, kiểm tay; jsdom dùng fallback sync); click problem của subnet không có device thì không zoom (target rỗng, no-op có chủ đích).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-10 Lưu trữ (autosave IndexedDB 30 s + khi đổi, khôi phục phiên, Save/Load .ntb.json validate schema, cảnh báo rời trang; Done khi Save→Load deep equal).

## 2026-10-15 — P1-08 Label & tooltip
- Đã làm:
  - `src/canvas/labels.ts`: `renderLabelTemplate` — thay `{hostname}`, `{mgmtIp}`, `{vendor}`, `{model}`, `{role}`, `{site}`; mặc định `{hostname}\n{mgmtIp}` (page.labelTemplate, placeholder lạ giữ nguyên).
  - `DeviceNode`: render label theo template — dòng đầu luôn hiện, dòng phụ (mgmtIp…) ẩn khi zoom < 50% (đọc zoom từ store của React Flow); tooltip hover = `title` gồm hostname · mgmtIp · vendor · model.
  - `src/canvas/LinkEdge.tsx`: custom edge với `EdgeLabelRenderer` — tên cổng 2 đầu + tốc độ ở giữa (dữ liệu do `buildEdges` gắn); label edge cũng ẩn khi zoom < 50%; giữ style màu/nét đứt từ `edgeVisual` và curvature link song song.
  - `CanvasView`: đăng ký `edgeTypes` ổn định (hằng số ngoài component tránh warning React Flow).
- Test / cách kiểm tra: 69/69 pass (5 test mới: template mặc định/custom/placeholder lạ/thiếu giá trị, buildNodes gắn label, buildEdges gắn sourceLabel/targetLabel/speed). Zoom ẩn/hiện và tooltip kiểm tra bằng tay (Playwright để gate P1-14). `make check` pass. ✅
- Còn dở / lỗi đã biết: label template chưa có UI sửa (thuộc multi-page P2-07); label tốc độ hiện text đơn giản, độ dày nét theo tốc độ đã có ở edgeVisual (fiber 3px).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-09 Validation (rule engine trong Web Worker, debounce 300ms, rule MVP SRS §6, panel Problems) — task lớn nhất còn lại của Phase 1 MVP lõi.

## 2026-10-15 — P1-07 Sidebar thuộc tính
- Đã làm:
  - Thêm dep `ipaddr.js` (đã trong Stack). `src/lib/validate.ts`: `isValidCidr` (strict dotted-quad — ipaddr.js mặc định chấp nhận viết tắt kiểu "10.0.0/24", đã chặn bằng regex), `parseCidrList` (danh sách IP cách nhau dấu phẩy/khoảng trắng).
  - Lệnh mới: `updateLink`, `updateDevicesBulk` (1 bước undo).
  - `src/panels/Sidebar.tsx`: sidebar phải với 3 tab khi chọn 1 thiết bị — General (hostname/vendor/model/role/lifecycle/mgmtIp CIDR/site; text commit khi blur, select/checkbox commit ngay, CIDR sai viền đỏ + không commit), Interfaces (từng interface: mode, speed, IP CIDR list, PoE, admin up), Links (link 2 đầu: hiển thị port ↔ peer, sửa status/speed/cableId/lengthM/notes). Chọn nhiều → form sửa hàng loạt role/lifecycle/site + nút Áp dụng.
  - `App.tsx`: layout Palette | Canvas | Sidebar.
- Test / cách kiểm tra: 64/64 pass (9 test mới: CIDR đúng/sai/viết tắt bị chặn, parseCidrList, updateDevice, updateDevicesBulk 1 bước undo, updateLink không đụng 2 đầu, throw khi thiếu link). `make check` pass. ✅
- Còn dở / lỗi đã biết: tab Notes và các field SRS §5 chưa có trong schema v1.0.0 (serial, OS, gateway, DNS, VLAN quản trị, tầng/phòng, bảo hành, công suất, PoE budget) — cần mở rộng schema ở task riêng; sửa hàng loạt cho interfaces (mode/accessVlan chung) chưa làm; label template {hostname}\n{mgmtIp} là P1-08.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-08 Label & tooltip (label template, label cổng 2 đầu + tốc độ, ẩn khi zoom < 50%, tooltip hover).

## 2026-10-15 — P1-06 Nối dây port → port
- Đã làm:
  - `src/model/ports.ts`: `mediaGroup` (copper/fiber/wireless/serial/console/logical — cổng chỉ nối được cùng nhóm, SRS §4), `usedPorts`, `firstFreePort` (auto-assign), `kindForMediaGroup`.
  - Lệnh `connectPorts` = `addLink` (chặn port đã có link, có sẵn P1-01) + `addPageEdge` — 1 bước undo.
  - `src/canvas/LinkDialog.tsx`: popup sau khi kéo dây từ thiết bị A thả vào B — chọn cổng 2 đầu; cổng đã dùng/sai loại bị disable + làm mờ kèm chú thích; mặc định = auto-assign cổng trống đầu tiên cùng nhóm media; loại link suy theo nhóm cổng.
  - Kéo dây: `onConnectStart` (lấy nodeId nguồn) → `onConnectEnd` (elementFromPoint tìm node đích) → mở dialog; handle nguồn connectable trên DeviceNode.
  - `src/canvas/edges.ts` + `buildEdges`: kiểu nét & màu theo SRS §4 — ethernet liền, fiber dày 3px, wireless `5 4`, serial `2 3`, logical `7 5`, console `1 4`; màu theo status up xanh / down đỏ / planned+admin_down xám; **link song song tách curvature tăng dần** theo cặp 2 đầu.
- Test / cách kiểm tra: 55/55 pass (10 test mới: phân nhóm media, usedPorts, auto-assign, connectPorts 1 bước undo + chặn port trùng + mở lại port sau khi xóa link, style theo kind/status, curvature tăng dần cho link song song). `make check` pass. ✅
- Còn dở / lỗi đã biết: kéo lại đầu dây để đổi cổng (SRS §4) chưa làm; sửa form Link thuộc P1-07; hiện dialog chỉ khi thả vào node (thả ra vùng trống = hủy). Bugs đã sửa trong phiên: rules-of-hooks (useCallback sau early return), `Record<Link['status']>`, `Link['status']` là optional sau json2ts — dùng hàm colorFor thay Record.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-07 Sidebar thuộc tính (tab General / Interfaces / Links cho Device; form Link; nhập CIDR; sửa hàng loạt).

## 2026-10-15 — P1-05 Thao tác chọn & sửa
- Đã làm:
  - Selection: đồng bộ 2 chiều store ↔ React Flow qua `onNodesChange` (select changes → `setSelection`), `buildNodes` nhận `selection` để render selected; rubber-band + Shift+click của RF giữ nguyên, multi-select Shift.
  - Lệnh mới: `compound` (gộp nhiều lệnh = 1 bước undo), `deleteDevices` (xóa hàng loạt 1 bước), `setNodeLocked`, `buildPasteCommand` (copy device: id/interface mới, **hostname tự đổi khi trùng** — sinh trong apply để tránh đụng nhau, giữ link nội bộ remap 2 đầu, node offset +20px, tất cả 1 bước undo).
  - Store: thêm `clipboard` (UI state, không undo).
  - `useCanvasShortcuts`: Ctrl/Cmd+Z (+Shift redo), Ctrl+A, Ctrl+C/X/V, Ctrl+D (duplicate), Delete/Backspace (xóa selection), Ctrl+L (lock/unlock selection); bỏ qua khi đang gõ trong input/select/textarea.
  - Toolbar: nút Lock/Unlock (disabled khi không có selection).
- Test / cách kiểm tra: 45/45 pass (6 test mới: deleteDevices 1 bước undo, paste đổi hostname SW-03/SW-04 + giữ link remap + offset vị trí + 1 bước undo, lock → draggable=false, compound, clipboard sống sót qua dispatch). `make check` pass. ✅
- Còn dở / lỗi đã biết: chọn link (edge) chưa lưu vào selection (làm cùng P1-06/P1-07 khi có form Link); Group/Ungroup (Ctrl+G) thuộc panel group — hoãn về P2-07; paste ngoài canvas (sau khi reload) chưa cần vì clipboard chỉ trong bộ nhớ.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-06 Nối dây port → port (handle theo interface, popup chọn cổng, auto-assign, chặn 2 link 1 port — lệnh addLink đã có sẵn từ P1-01).

## 2026-10-15 — P1-03 Palette (làm sau P1-04 theo thứ tự đã duyệt)
- Đã làm:
  - `src/panels/Palette.tsx`: sidebar trái — template phân nhóm theo SRS §2 (từ catalog P1-02), ô tìm kiếm (lọc theo label + typeId), item kéo thả HTML5 (MIME `application/ntb-device`); icon DeviceIcon từng loại.
  - `src/catalog/hostname.ts`: `nextHostname` — hostname tự sinh `SW-01`, `RTR-01`… theo prefix từng loại, bỏ qua tên đã tồn tại, chung namespace toàn document.
  - `src/canvas/dropDevice.ts`: `deviceDropCommand` — tạo device từ template + node view tại vị trí thả (1 command → undo/redo được).
  - `CanvasView`: `onDragOver`/`onDrop` + `screenToFlowPosition` (đúng vị trí dù đang zoom/pan).
  - `App.tsx`: layout flex — Palette trái, canvas phải.
- Test / cách kiểm tra: 39/39 pass (7 test mới: hostname sinh/tăng/bỏ qua/trùng loại, drop tạo device + node đúng vị trí, undo xóa sạch, 2 lần thả liên tiếp → CAM-01/CAM-02). `make check` pass. ✅
- Còn dở / lỗi đã biết: kéo thả thật trên trình duyệt kiểm tra bằng tay (Playwright để gate P1-14); chưa có Favorites/Recently used (SRS §2 — cân nhắc thêm khi có localStorage, có thể gộp P1-12).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-05 Thao tác chọn & sửa (multi-select, rubber-band, copy/paste, duplicate, delete cascade, lock, phím tắt §3).

## 2026-10-15 — ADR-010/011 cập nhật tài liệu
- Đã làm:
  - `docs/DECISIONS.md`: thêm ADR-011 (giám sát tùy chọn theo thiết bị, nhiều site qua VPN, remote poller để Phase 4). ADR-010 đã có từ phiên trước nên bỏ qua theo chỉ dẫn.
  - `CLAUDE.md` + `docs/SRS.md` §9: React 19 đã cập nhật từ phiên trước (bỏ qua).
  - `docs/SRS.md` §7: ví dụ JSON thêm `pollerId: "central"`, `dependsOnDeviceId: null` vào monitoring; §11: thêm đoạn "Nhiều site / VPN" (unknown khi thiết bị cha unreachable; 5 trạng thái; giới hạn dải IP trùng).
  - `docs/PLAN.md`: chèn P3-05b (phụ thuộc theo site) sau P3-05; thêm remote poller vào Phase 4.
  - `schema/ntb.schema.json`: `monitoring.pollerId` (string, default "central"), `monitoring.dependsOnDeviceId` (null hoặc UUID, dùng anyOf vì $ref không ghép được với type). SchemaVersion giữ 1.0.0 (chưa phát hành bản nào).
  - `testdata/sample-small.ntb.json`: 10 device đều có 2 field mới.
  - Go `MonitoringConfig`: thêm `PollerID`, `DependsOnDeviceID` — round-trip test vẫn pass.
  - `make types` sinh lại TS types.
  - React 19: đã chạy từ P0-01 (react 19.2.8 + @types 19), không có xung đột peer dependency khi cài @xyflow/react/zustand/immer/catalog deps.
- Test / cách kiểm tra: `make check` pass — 32 test FE (ajv + round-trip io + model + catalog + canvas), Go round-trip với file mẫu mới, lint 0 issues. ✅
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Palette.

## 2026-10-15 — P1-04 Canvas cơ bản (làm trước P1-03 theo đề xuất đã duyệt)
- Đã làm:
  - Thêm dep: `@xyflow/react` (React Flow v12).
  - `src/canvas/adapters.ts`: buildNodes/buildEdges từ NtbData → React Flow (canvas chỉ đọc model qua adapter, đúng quy ước); bỏ qua node thiếu device.
  - `src/canvas/DeviceNode.tsx`: custom node memo hóa, subscribe đúng device của nó (không re-render cả canvas khi 1 node đổi); icon + hostname; handle placeholder cho P1-06.
  - `src/canvas/CanvasView.tsx`: ReactFlow zoom 10–400% (minZoom 0.1/maxZoom 4), pan (Space + kéo, panOnDrag), selectionOnDrag + multiSelection Shift, snapToGrid bật/tắt + lưới 10/20/40 px, MiniMap, Controls, Fit to screen (nút + Shift+1); kéo node → `setNodePosition` với mergeKey `drag:<id>` (gộp 1 bước undo); `useEnsurePage` tự tạo page đầu khi document trống.
  - `App.tsx`: render CanvasView full-screen.
- Test / cách kiểm tra: 32/32 pass (5 test adapter mới + smoke render canvas trong jsdom với ResizeObserver mock); dev server chạy, HTTP 200; `make check` pass. ✅
- Còn dở / lỗi đã biết: kéo/thả và zoom cần kiểm tra bằng tay trên trình duyệt (Playwright E2E để sau — gate P1-14); chưa có selection sync vào store (làm ở P1-05); deleteKeyCode=null tạm (P1-05 sẽ bật có cascade).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Palette (đã có nền canvas để kéo thả vào).

## 2026-10-15 — P1-02 Device catalog
- Đã làm:
  - `src/catalog/types.ts`: `PortRun` (prefix + count + media/speed/mode/poe) → `generateInterfaces`.
  - `src/catalog/catalog.ts`: template cho mọi loại thiết bị trong SRS §2, chia 5 nhóm gốc + Other (`DEVICE_GROUP_ORDER`, `getTemplate`, `templatesByGroup`). Ví dụ: L2 switch 24×RJ45 + 4×SFP; PoE switch 24×RJ45 PoE + 2×SFP+; router Gi0/0/0–2 + Te0/1/0; server eno1–4 + 2×SFP+.
  - `src/catalog/icons.tsx`: `DeviceIcon` — SVG line-art 24×24 stroke `currentColor` cho từng loại (dark mode tự theo theme), có icon generic dự phòng.
  - `src/catalog/createFromTemplate.ts`: `createDeviceFromTemplate(typeId, hostname)` — dùng factory của P1-01, sinh đủ interface theo port layout.
- Test / cách kiểm tra: 27/27 test pass (10 test catalog mới: số lượng port, tên port, PoE, media, unique id, nhóm không rỗng, throw khi thiếu template). `make check` pass. ✅
- Còn dở / lỗi đã biết: label tiếng Việt cho nhóm/thiết bị sẽ qua react-i18next ở P1-12 (đã chừa key `device.<typeId>`, `group.<id>`); icon chưa có mẫu theo hãng/model (Phase 2).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Palette (danh sách theo nhóm, ô tìm kiếm, kéo thả vào canvas) — cần kết hợp với canvas P1-04, đề xuất làm P1-04 canvas cơ bản trước rồi P1-03 kéo thả ngay sau.

## 2026-10-15 — P1-01 Store & command
- Đã làm:
  - Thêm deps: `zustand`, `immer`.
  - `src/model/types.ts`: `NtbData` — Network + View model keyed theo id (dùng lại types sinh từ schema; json2ts đặt tên `Vlan` thay `VLAN`).
  - `src/model/factory.ts`: `newId()` (crypto.randomUUID), `createDevice/Interface/Link` với mặc định hợp lý.
  - `src/model/io.ts`: `fromNtbProjectFile` / `toNtbProjectFile` (Record ↔ array, giữ thứ tự page qua `pageOrder`).
  - `src/model/commands.ts`: `addPage`, `addDevice` (kèm node view), `updateDevice`, `updateInterface`, `deleteDevice` (cascade link + node), `addLink` (chặn port đã có link), `deleteLink`, `setNodePosition` (có mergeKey), `addVlan` (chặn trùng vlanId), `deleteVlan`.
  - `src/model/store.ts`: Zustand store; undo/redo bằng snapshot (Immer copy-on-write, rẻ); UNDO_LIMIT 200; gộp lệnh liên tiếp cùng `mergeKey` thành 1 bước undo (drag); `selection` là UI state ngoài undo.
- Test / cách kiểm tra: 17 test pass — device CRUD + undo/redo, cascade delete, chặn 2 link 1 port, undo ≥ 150 bước, merge 3 drag → 1 undo, redo bị xóa khi dispatch mới, selection sống sót qua undo, round-trip file mẫu. `make check` pass. ✅
- Còn dở / lỗi đã biết: chưa có lệnh cho subnet/group (làm cùng panel tương ứng); `addLink` mới thêm edge vào page chưa làm (canvas P1-06 sẽ thêm khi nối dây).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-02 Device catalog (template 5 nhóm thiết bị, icon SVG, port layout mặc định).

## 2026-10-15 — P0-04 Docker Compose dev
- Đã làm:
  - `deploy/docker-compose.yml`: service `web` (build multi-stage, cổng 8080→80, depends_on db healthy) + `db` (postgres:16-alpine, volume `db_data`, healthcheck `pg_isready`); cấu hình qua env có mặc định dev.
  - `deploy/web.Dockerfile`: node:22-alpine `npm ci && npm run build` → nginx:1.27-alpine phục vụ static.
  - `deploy/nginx.conf`: cache `/assets/`, SPA fallback `try_files … /index.html`, comment sẵn block proxy `/api` cho Phase 2.
  - `deploy/.env.example`: WEB_PORT, POSTGRES_USER/PASSWORD/DB.
- Test / cách kiểm tra: `docker compose -f deploy/docker-compose.yml up -d --build` → web Up, db Up (healthy); curl http://localhost:8080 trả HTTP 200 với title "Network Topology Builder"; SPA fallback /some-route trả 200. ✅
- Còn dở / lỗi đã biết: không. (Stack dev đang chạy — tắt bằng `docker compose -f deploy/docker-compose.yml down`.)
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **Phase 1 — P1-01 Store & command** (Network model + View model, Zustand + Immer, command pattern, undo/redo).

## 2026-10-15 — P0-03 Schema file dự án
- Đã làm:
  - `schema/ntb.schema.json` v1.0.0 (JSON Schema draft 2020-12) phản chiếu SRS §7: project, vlans, subnets, devices/interfaces, links (a/b port→port), groups, assets, pages; enum cho device type/role/lifecycle, media, speed, mode, link kind/medium/status, page layer, routing; UUID/IPv4 CIDR theo pattern; `additionalProperties: false` để bắt lỗi chính tả.
  - `testdata/sample-small.ntb.json`: 10 thiết bị (router, firewall, 2× L3 core, 2× access, server, PC, camera, AP), 3 VLAN + 3 subnet, 10 link port→port hợp lệ, 1 page + 1 group zone.
  - `make types` → `frontend/src/types/ntb.ts` bằng `json-schema-to-typescript` (devDep mới, ngoài PLAN cần bạn biết); thêm `ajv-formats` cho `format: date-time`.
  - Test ajv `src/schema/schema.test.ts`: sample PASS; schemaVersion sai, vlanId out of range, unknown property → FAIL.
  - Go struct `backend/internal/model` + test round-trip với file mẫu (đúng quy ước CLAUDE.md). Bài học: `omitempty` phá round-trip với `false`/`{}`/`[]`/`""`; `allowedVlans` dùng `*[]int` để phân biệt vắng mặt vs `[]`.
  - (Đã chốt từ phiên trước) ADR-010 React 19; SRS + CLAUDE.md cập nhật.
- Test / cách kiểm tra: `make check` pass — 5 test FE (schema 4 + App smoke 1), Go round-trip + schemaVersion pass, oxlint/golangci-lint 0 issues. ✅
- Còn dở / lỗi đã biết: schema thuần không diễn đạt được ràng buộc chéo (vd 2 đầu link cùng 1 interface) — việc của validation engine (P1-09), không phải schema.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P0-04 Docker Compose dev (web + db Postgres 16).

## 2026-10-15 — P0-02 Lint & test
- Đã làm:
  - Frontend: giữ **oxlint** (có sẵn từ template, thay cho ESLint trong PLAN — người dùng đã chốt); thêm **Prettier** (`.prettierrc.json`, `.prettierignore`); thêm **Vitest** + jsdom + Testing Library (`vitest.config.ts`, `vitest.setup.ts`, test smoke `src/App.test.tsx`); d.ts đăng ký matcher jest-dom.
  - Backend: `.golangci.yml` (default standard + revive + sloglint); cài golangci-lint qua Homebrew.
  - `Makefile`: `check` = oxlint + prettier check + tsc -b + vitest + go vet + golangci-lint + go test; thêm target `format`.
  - Đổi `__dirname` → `import.meta.dirname` trong vite/vitest config theo khuyến nghị Vite.
- Test / cách kiểm tra: `make check` pass sạch (exit 0, 1 test pass, "0 issues") trên repo trống. ✅
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: (treo từ P0-01) React 18 hay 19 — cần chốt để cập nhật ADR.
- Đề xuất quyết định cần chốt: không mới.
- Task tiếp theo đề xuất: P0-03 Schema file dự án (`ntb.schema.json` v1.0.0 + file mẫu + `make types`).

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
