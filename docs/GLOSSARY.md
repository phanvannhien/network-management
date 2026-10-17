# Thuật ngữ mạng dùng trong Network Topology Builder

Giải thích ngắn, bằng lời thường, cho người không chuyên mạng. Mỗi mục: **là gì** → **ví dụ thực tế** → **trong hệ thống ở đâu**.
Nhóm theo thứ tự hay gặp khi nhập liệu.

---

## 1. Thiết bị và vị trí

| Thuật ngữ | Là gì | Ví dụ | Trong hệ thống |
| --- | --- | --- | --- |
| **Danh mục** | Nhánh chia việc quản lý trong tổ chức (công ty con, khách hàng, chi nhánh, bộ phận…), chia bao nhiêu cấp cũng được; mỗi danh mục có tên tự do và mã viết tắt | Tổ chức CJ → danh mục CJ Feed (`CJFEED`) | Danh mục & Sites → cây bên trái |
| **Site** | Một địa điểm thật (văn phòng, nhà máy, kho, IDC); gắn vào danh mục bất kỳ hoặc thẳng vào tổ chức | Văn phòng HCM | Danh mục & Sites |
| **Khung site / location** | Hình chữ nhật trên sơ đồ gom thiết bị của một site hoặc location (tòa, tầng, phòng), tên theo site/location. Thiết bị mới thả vào khung nhận site đó; thiết bị có sẵn khác site → cảnh báo. Cụm HA/stack có khung chấm tự động | Khung "FPT IDC" chứa cặp FortiGate HA | Sơ đồ → Khung (Ctrl+G) |
| **Mã site đầy đủ** | Ghép tự động: mã tổ chức – mã các danh mục – mã riêng của site. Đổi mã danh mục/tổ chức thì mã các site bên dưới đổi theo, hệ thống liệt kê để xác nhận trước | `CJ-CJFEED-HCM` | Form site, cây danh mục |
| **Hostname** | Tên của thiết bị trên mạng, do kỹ sư đặt; chỉ chữ không dấu, số, "-", tối đa 63 ký tự (Windows chỉ giữ 15) | `AGRI-BD01-FW01` = mã site bỏ mã tổ chức – loại – số | Thiết bị → Hostname; sơ đồ gợi ý theo quy ước này (không trùng trong tổ chức, trừ thành viên cùng cụm) |
| **S/N (Serial Number)** | Số seri in trên thiết bị, dùng để bảo hành | `FGT60F0000123` | Thiết bị → S/N |
| **Part Number** | Mã sản phẩm của hãng (đặt hàng, tra EOL) | `FG-100F`, `C9200-24P-E` | Thiết bị → Part number |
| **Firmware / OS** | Phần mềm chạy trên thiết bị | `FortiOS 7.4.5`, `IOS-XE 17.9` | Thiết bị → Firmware |
| **Rack, U** | Tủ đựng thiết bị; 1U = 4,45 cm chiều cao. Thiết bị chiếm từ U thấp nhất trở lên | Firewall 1U ở U40, server 2U ở U10–U11 | Thiết bị → Rack, Vị trí U, Chiều cao |
| **EOL / EOS** | End-of-Life / End-of-Support: ngày hãng ngừng bán / ngừng hỗ trợ | Hãng ngừng vá lỗi sau EOS | Thiết bị → Mua sắm & hỗ trợ |
| **Managed / Bên ngoài** | Thiết bị của mình quản lý hay của bên khác đặt tại site | Modem của ISP là "bên ngoài" | Thiết bị → Quản lý |

## 2. Cổng (interface)

| Thuật ngữ | Là gì | Ví dụ |
| --- | --- | --- |
| **Interface / cổng** | Điểm kết nối mạng của thiết bị, thật hoặc ảo | `Gi1/0/1`, `Vlan10` |
| **Cổng vật lý** | Cổng thật, cắm dây | `Gi1/0/1` (1 Gbps RJ45), `Te1/1/1` (10 Gbps SFP+) |
| **Media** | Kiểu đầu cắm: RJ45 (dây đồng), SFP/SFP+/SFP28/QSFP (module quang hoặc DAC theo tốc độ 1/10/25/40–100G) | Uplink switch thường SFP+ |
| **PoE** | Cấp nguồn qua dây mạng cho camera, AP, điện thoại IP | Switch PoE cấp điện cho camera |
| **SVI (Vlan interface)** | Cổng ảo đại diện một VLAN trên switch L3; thường là IP quản trị hoặc gateway của VLAN | `Vlan10` có IP `10.72.114.2/24` |
| **Loopback** | Cổng ảo luôn hoạt động, router hay dùng làm IP quản trị | `Loopback0` = `10.255.0.1/32` |
| **Tunnel** | Đường hầm ảo nối 2 thiết bị qua Internet/mạng khác | VPN IPsec từ nhà máy về IDC |
| **Sub-interface** | Cổng con trên một cổng vật lý, mỗi cổng con một VLAN ("router-on-a-stick") | `Gi0/0.10` xử lý VLAN 10 (dot1q 10) |
| **LAG / Port-channel / LACP** | Gộp nhiều cổng thành 1 đường: tăng băng thông, đứt 1 dây vẫn chạy | `Po1` = `Te1/1/1` + `Te1/1/2` |
| **MAC** | Địa chỉ phần cứng duy nhất của cổng | `aa:bb:cc:dd:ee:ff` (Cisco viết `aabb.ccdd.eeff`) |
| **Admin up / shutdown** | Cổng đang bật hay bị tắt bằng cấu hình | Cổng không dùng nên shutdown |
| **Kết nối (link) vật lý** | Dây thật nối 2 cổng: Ethernet đồng (gồm DAC), quang, stack/HA, DSL, console, serial, dây nguồn — mỗi cổng 1 dây. Không dây và 4G/5G thì một cổng phục vụ nhiều kết nối | `BD-SW01 Gi1/0/48` ↔ `BD-FW01 port1`, Cat6 |
| **Kết nối logical** | Không phải dây: VPN/IPsec, GRE giữa các site (đầu mút là interface tunnel, hoặc cổng WAN mà VPN gắn vào). LAG vẽ thành từng dây thành viên; MPLS là dịch vụ WAN | VPN từ firewall Bình Định về IDC |
| **Cable ID** | Mã in trên nhãn dây, để tìm đúng dây trong tủ rack | `BD-C001` |
| **DAC** | Cáp **đồng** twinax gắn sẵn 2 đầu SFP, nối gần (≤ 7 m, trong rack) thay cho quang — trên hệ thống là loại Ethernet | Switch ↔ server 10G cùng rack |
| **AOC** | Cáp **quang** gắn sẵn 2 đầu module, dài hơn DAC | Hai rack cạnh nhau, 15 m |
| **Single-mode / Multi-mode (SM/MM)** | Hai loại sợi quang không cắm lẫn: SM (vỏ vàng, đi xa km), MM OM3/OM4/OM5 (trong tòa nhà) | Uplink 2 km: SM, module LR |
| **Đầu nối quang LC / SC / MPO** | LC nhỏ (hay ở SFP), SC vuông (ODF, ONT), MPO nhiều sợi (40/100G) | LC–LC |
| **PON, OLT, bộ chia quang** | Mạng quang thụ động: 1 cổng PON của OLT qua bộ chia tới nhiều ONT — cổng PON nối nhiều dây | OLT pon0/1 → splitter 1:32 |
| **Dây nguồn** | Từ UPS/PDU tới thiết bị (2 nguồn = 2 dây); biết thiết bị nào tắt khi một UPS hỏng | UPS01 outlet1 → CORE01 |
| **Dây stack / HA heartbeat** | Nối thành viên một cụm: cáp stack của switch, heartbeat giữa 2 firewall HA | FW01 ha ↔ FW02 ha |
| **Dịch vụ WAN** | Loại đường nhà mạng: Internet FTTH (dùng chung), Internet trực tiếp (IP tĩnh, SLA), MPLS VPN, kênh thuê riêng, Metro Ethernet, 4G/5G | wan1: Internet trực tiếp VNPT 200 Mbps |

## 3. VLAN

| Thuật ngữ | Là gì | Ví dụ |
| --- | --- | --- |
| **VLAN** | Chia một switch thành nhiều mạng riêng, mỗi mạng một số (1–4094) | VLAN 10 = quản trị, VLAN 20 = camera, VLAN 30 = văn phòng |
| **Access** | Cổng mang **1** VLAN, cắm thiết bị đầu cuối | Cổng cắm camera: access VLAN 20 |
| **Trunk** | Cổng mang **nhiều** VLAN, nối switch–switch, switch–firewall | Uplink: trunk, allowed `10,20,30` |
| **Allowed VLANs** | Các VLAN được phép đi qua cổng trunk | `10,20-30` |
| **Native VLAN** | Trên trunk, VLAN đi không gắn nhãn (mặc định VLAN 1) | Native VLAN 1 |
| **802.1Q / tag / dot1q** | Nhãn VLAN gắn vào gói tin khi đi trên trunk | Sub-interface `Gi0/0.10` → dot1q 10 |
| **Routed** | Cổng có IP như cổng router, không thuộc VLAN | Cổng WAN của router |

## 4. IP

| Thuật ngữ | Là gì | Ví dụ |
| --- | --- | --- |
| **IP** | Địa chỉ của thiết bị trên mạng | `10.72.114.2` |
| **CIDR / prefix (/24…)** | Số bit phần mạng; `/24` = mạng 256 địa chỉ (255.255.255.0) | `10.72.114.2/24` thuộc mạng `10.72.114.0/24` |
| **Subnet** | Một dải mạng; IPAM tính số IP đang dùng / còn trống | `10.72.114.0/24` — menu IPAM |
| **IPAM** | Sổ quy hoạch IP: mạng nào cho việc gì, còn bao nhiêu IP trống, IP nào thuộc thiết bị nào — tránh gán trùng | Trước khi lắp camera: mở subnet camera → "Tìm IP trống" |
| **Dải IP (quy hoạch)** | Chia subnet thành khúc theo mục đích: **DHCP** (máy chủ DHCP tự cấp), **IP tĩnh** (đặt tay), **dành riêng** (giữ lại) | `.2–.49` tĩnh, `.100–.200` DHCP, `.250–.254` dành riêng |
| **DHCP** | Dịch vụ tự cấp IP cho máy tính/điện thoại khi vào mạng; IP trong dải DHCP không gán tay | Firewall cấp `.100–.200` cho laptop |
| **IP trống kế tiếp** | IP đầu tiên chưa ai dùng: bỏ qua gateway, IP của mọi thiết bị (cùng VRF), IP quản trị cụm, dải DHCP và dành riêng | Subnet → "Tìm IP trống"; form IP thiết bị → "Lấy IP trống từ subnet" |
| **Địa chỉ mạng / broadcast** | Địa chỉ đầu và cuối của subnet IPv4, không gán cho thiết bị (trừ /31, /32) | `.0` và `.255` của một /24 |
| **Gateway** | Thiết bị chuyển gói ra mạng khác, thường là `.1` | Firewall `10.72.114.1` |
| **IP chính / phụ** | Mỗi interface có 1 IP chính (mỗi IPv4/IPv6), có thể thêm IP phụ | |
| **IP quản trị** | IP kỹ sư dùng để SSH/web vào thiết bị = IP chính của interface quản trị | Switch quản trị qua `Vlan10` |
| **NAT** | Đổi địa chỉ khi đi qua firewall/router; thiết bị bên trong được "nhìn thấy" bằng IP khác | Camera `10.72.120.5` được truy cập qua `203.0.113.10:8080` |
| **VIP / VRRP / HSRP** | Hai router (hoặc core) cùng làm gateway dự phòng cho một mạng: mỗi máy một IP riêng, cùng chia một IP ảo (VIP); máy nào đang chạy thì giữ VIP. VRRP là chuẩn chung, HSRP của Cisco. Là trường hợp duy nhất một IP được phép trùng giữa hai thiết bị khác cụm (vai trò IP "VIP") | CORE1 `10.0.10.2`, CORE2 `10.0.10.3`, VIP `10.0.10.1` trên cả hai |
| **IP public** | IP trên Internet | `203.0.113.10` |
| **Template thiết bị / Thư viện thiết bị** | Template = khuôn của một model (hãng, model, số U, danh sách cổng đúng tên CLI); thiết bị tạo từ template tự có đủ cổng. Thư viện thiết bị = các template có sẵn của dòng phổ biến (Cisco, Fortinet, TP-Link…) đi kèm phần mềm; dùng thì chép thành template của tổ chức | Kho → Template → "Thêm từ thư viện"; nhập Excel tự dùng thư viện |
| **Kiểm tra sơ đồ (Vấn đề)** | Hệ thống tự soát sơ đồ khi vẽ: **Lỗi** = gần như chắc chắn sai (IP trùng, 2 dây một cổng), **Cảnh báo** = nên xem (RJ45 cắm SFP, IP là địa chỉ broadcast), **Ghi chú** = còn thiếu (dây chưa gán cổng). Không chặn lưu | Nút ⚠ trên toolbar sơ đồ → panel Vấn đề → bấm dòng để tới thiết bị |
| **VRF** | Bảng định tuyến riêng trên cùng thiết bị; cùng một IP ở 2 VRF khác nhau là hợp lệ | Hai khách hàng cùng dùng `192.168.1.0/24` trên một router MPLS |
| **Poll address** | Địa chỉ hệ thống giám sát (Phase 3) dùng để hỏi thiết bị; trống = IP quản trị | Poller đi qua IP NAT |
| **IPv6** | Thế hệ địa chỉ mới, dài hơn | `2001:db8::1/64` |

## 4b. Nhóm thiết bị đầu cuối

| Thuật ngữ | Là gì | Ví dụ |
| --- | --- | --- |
| **Nhóm thiết bị đầu cuối** | Nhiều thiết bị giống nhau (camera, PC, điện thoại IP…) quản lý như một mục: dải IP, số lượng dự kiến, danh sách thành viên. Trên sơ đồ là một biểu tượng có "đã dùng/tổng" | "Camera nhà xưởng" 14/20 |
| **Đầu cuối trên sơ đồ / nối dải cổng** | Kéo "Camera", "PC"… từ mục Đầu cuối của thư viện → một nhóm đại diện, không vào danh sách thiết bị. Nối với switch chọn "từ cổng 1 đến cổng 24": mỗi cổng một dây, sơ đồ gộp thành một dây ghi "Gi1/0/1–24 (24)" | 24 camera tầng 1 trên switch PoE |
| **Thành viên** | Một thiết bị trong nhóm, chỉ ghi tên, IP, MAC, cổng switch đang cắm | `CAM-01` · `10.72.120.2` · cắm `BD-SW01 Gi1/0/5` |
| **Tách thành thiết bị** | Biến một thành viên thành thiết bị đầy đủ khi cần quản lý riêng (S/N, bảo hành, giám sát) | Camera cổng chính cần theo dõi bảo hành |

## 5. Dự phòng và cụm thiết bị

| Thuật ngữ | Là gì | Ví dụ |
| --- | --- | --- |
| **Cụm (cluster)** | Nhiều thiết bị vật lý chạy như một; mỗi con vẫn có S/N, bảo hành riêng | |
| **HA active-passive** | Một con chạy, một con chờ; con chính hỏng thì con kia tự nhận việc. Chung IP quản trị | Cặp FortiGate HA |
| **HA active-active** | Cả hai cùng chạy, chia tải | Cặp firewall chia tải |
| **Stack** | Nhiều switch nối cáp stack, cấu hình như 1 switch: chung hostname/IP; cổng đánh số theo thành viên (`Gi1/0/x`, `Gi2/0/x`) | 3 × Cisco C9300 thành 1 switch 144 cổng |
| **vPC** (Cisco Nexus) | 2 switch riêng (mỗi con IP riêng) nhưng thiết bị bên dưới cắm LAG sang cả hai | Core Nexus |
| **VSS** (Cisco Catalyst) | 2 switch gộp thành 1 switch logic | Core Catalyst |
| **IP quản trị cụm** | IP chung của cả cụm (vd IP của cặp HA), không nằm trên interface nào; IPAM vẫn tính là đang dùng | `10.72.114.3` của stack core |

Quy định trong hệ thống (ADR-027): HA cho firewall/router/VPN/LB/WLC/WAF/proxy/IDS-IPS/SD-WAN/server/NAS; Stack cho switch;
vPC/VSS cho switch L2/L3; kiểu "Khác" không giới hạn. Thành viên cùng cụm phải cùng loại thiết bị.

## 6. Loại thiết bị hay gặp

| Loại | Vai trò |
| --- | --- |
| **Router** | Nối các mạng với nhau / với Internet, WAN |
| **Switch L2** | Nối thiết bị trong cùng mạng, chia VLAN |
| **Switch L3** | Switch có thêm định tuyến giữa các VLAN (SVI) — thường làm core/distribution |
| **Switch PoE** | Switch cấp nguồn cho camera, AP, điện thoại IP |
| **Firewall** | Kiểm soát lưu lượng, NAT, VPN — thường là cửa ra Internet |
| **Access Point (AP) / Wireless controller** | Phát Wi-Fi / quản lý tập trung các AP |
| **Load balancer** | Chia tải cho nhiều server |
| **SD-WAN edge** | Thiết bị WAN thông minh nối nhiều đường truyền |
| **ONT / Modem** | Thiết bị đầu cuối của nhà mạng (thường "bên ngoài"): ONT nhận cáp quang (GPON), modem nhận cáp đồng/cáp truyền hình. Khác OLT — thiết bị phía nhà mạng gom nhiều ONT |
| **NVR** | Đầu ghi camera |
| **Internet / nhà mạng** | Hình đám mây: Internet hoặc mạng MPLS của nhà mạng — đầu bên kia của đường WAN, không phải tài sản (luôn "bên ngoài", được trùng tên) |
| **OLT** | Gom nhiều ONT qua cổng PON (mạng GPON/POL nội bộ) |
| **Cầu không dây (wireless bridge)** | Nối 2 tòa nhà/nhà xưởng bằng sóng thay cáp |
| **Console server** | Gom cổng console nhiều thiết bị, để vào cấu hình khi mạng chính hỏng |
| **UPS / PDU** | Bộ lưu điện / thanh nguồn trong rack |

**Vai trò (role):** Core (lõi, trung tâm), Distribution (tầng giữa), Access (tầng truy cập, cắm thiết bị đầu cuối), Edge (biên,
ra Internet), DMZ (vùng server công khai), OOB (mạng quản trị riêng, ngoài luồng dữ liệu).
