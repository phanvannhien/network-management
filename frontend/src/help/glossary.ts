/**
 * Networking terms explained for non-specialists (docs/GLOSSARY.md is the readable copy). Field help buttons (?)
 * and the in-app glossary page read from here. Keep entries short: what it is, a real example.
 */

export type GlossaryGroup = 'device' | 'port' | 'vlan' | 'ip' | 'cluster' | 'org'

export interface GlossaryEntry {
  id: string
  group: GlossaryGroup
  term: { vi: string; en: string }
  what: { vi: string; en: string }
  example?: { vi: string; en: string }
}

const e = (
  id: string,
  group: GlossaryGroup,
  term: [string, string],
  what: [string, string],
  example?: [string, string],
): GlossaryEntry => ({
  id,
  group,
  term: { vi: term[0], en: term[1] },
  what: { vi: what[0], en: what[1] },
  example: example && { vi: example[0], en: example[1] },
})

export const GLOSSARY: GlossaryEntry[] = [
  // --- devices and placement ---
  e(
    'hostname',
    'device',
    ['Hostname', 'Hostname'],
    [
      'Tên của thiết bị trên mạng, do kỹ sư đặt; nên theo quy ước để nhìn tên biết thiết bị ở đâu, làm gì. Chỉ dùng chữ không dấu, số và "-", tối đa 63 ký tự; máy chủ/PC chạy Windows chỉ giữ 15 ký tự đầu.',
      'The device name on the network, set by the engineers; a naming convention tells where it is and what it does. Unaccented letters, digits and "-" only, at most 63 characters; Windows servers/PCs keep only the first 15.',
    ],
    [
      'AGRI-BD01-FW01 = firewall số 1 tại site AGRI-BD01 (mã site bỏ mã tổ chức – loại – số). Khi thêm thiết bị trên sơ đồ, hệ thống gợi ý tên theo quy ước này.',
      'AGRI-BD01-FW01 = firewall 1 at site AGRI-BD01 (site code without the organization code – type – number). The editor suggests names this way.',
    ],
  ),
  e(
    'serial',
    'device',
    ['S/N (Serial Number)', 'S/N (serial number)'],
    [
      'Số seri in trên tem thiết bị, duy nhất cho từng hộp; hãng dùng để bảo hành, RMA.',
      'The serial printed on the device label, unique per box; the vendor uses it for warranty and RMA.',
    ],
    ['FGT60F0000123', 'FGT60F0000123'],
  ),
  e(
    'part-number',
    'device',
    ['Part number', 'Part number'],
    [
      'Mã sản phẩm của hãng để đặt hàng và tra ngày EOL; nhiều thiết bị cùng model có cùng part number.',
      "The vendor's product code used to order and look up EOL; devices of one model share it.",
    ],
    ['FG-100F, C9200-24P-E', 'FG-100F, C9200-24P-E'],
  ),
  e(
    'asset-tag',
    'device',
    ['Mã tài sản', 'Asset tag'],
    [
      'Mã quản lý tài sản nội bộ của công ty (tem dán), khác S/N của hãng.',
      "The company's internal asset label, different from the vendor serial.",
    ],
    ['TS-2024-0153', 'TS-2024-0153'],
  ),
  e(
    'firmware',
    'device',
    ['Firmware / OS', 'Firmware / OS'],
    [
      'Phần mềm hệ điều hành chạy trên thiết bị; cần biết để vá lỗi bảo mật.',
      'The operating system running on the device; needed to track security fixes.',
    ],
    ['FortiOS 7.4.5, IOS-XE 17.9.4', 'FortiOS 7.4.5, IOS-XE 17.9.4'],
  ),
  e(
    'lifecycle',
    'device',
    ['Vòng đời', 'Lifecycle'],
    [
      'Trạng thái thiết bị: dự kiến (sắp mua), đang dùng, dự phòng (nằm trong kho), đang bảo hành (RMA), đã thanh lý.',
      'Device state: planned, active, spare (in stock), in RMA (at the vendor), retired.',
    ],
  ),
  e(
    'role',
    'device',
    ['Vai trò', 'Role'],
    [
      'Vị trí của thiết bị trong thiết kế mạng: Core (lõi), Distribution (tầng giữa), Access (tầng cắm thiết bị đầu cuối), Edge (biên, ra Internet), DMZ (vùng server công khai), OOB (mạng quản trị riêng).',
      'Where the device sits in the design: Core, Distribution, Access (end devices), Edge (Internet), DMZ (public servers), OOB (separate management network).',
    ],
    [
      'Switch cắm camera là Access; firewall ra Internet là Edge.',
      'The switch for cameras is Access; the Internet firewall is Edge.',
    ],
  ),
  e(
    'managed',
    'device',
    ['Quản lý / Bên ngoài', 'Managed / external'],
    [
      'Thiết bị do mình quản lý, hay của bên khác đặt tại site (vd nhà mạng) — vẫn vẽ lên sơ đồ nhưng không chịu trách nhiệm cấu hình.',
      'Whether we run the device or it belongs to someone else on site (e.g. the ISP) — drawn, but not ours to configure.',
    ],
    ['Modem/ONT của nhà mạng là "bên ngoài".', 'The ISP\'s modem/ONT is "external".'],
  ),
  e(
    'rack-u',
    'device',
    ['Rack và U', 'Rack and U'],
    [
      'Rack là tủ đựng thiết bị chuẩn 19 inch; 1U cao 4,45 cm. Thiết bị chiếm từ U thấp nhất lên theo chiều cao.',
      'A rack is a 19-inch cabinet; 1U is 4.45 cm. A device occupies from its lowest U upwards.',
    ],
    ['Server 2U đặt ở U10 chiếm U10–U11.', 'A 2U server at U10 occupies U10–U11.'],
  ),
  e(
    'eol',
    'device',
    ['EOL / EOS', 'EOL / EOS'],
    [
      'End-of-Life / End-of-Support: ngày hãng ngừng bán / ngừng hỗ trợ và vá lỗi. Sau EOS nên thay thiết bị.',
      'End of life / end of support: when the vendor stops selling / supporting and patching it. Replace after EOS.',
    ],
  ),
  e(
    'template',
    'device',
    ['Template thiết bị', 'Device template'],
    [
      'Khuôn theo model: hãng, model, part number và danh sách cổng. Tạo thiết bị từ template thì cổng được sinh sẵn.',
      'A per-model blueprint: vendor, model, part number and ports. Devices created from it get the ports generated.',
    ],
    [
      'Template "Cisco C9200-24P" sinh 24 cổng Gi1/0/1–24 + 4 cổng uplink.',
      'The "Cisco C9200-24P" template generates Gi1/0/1–24 plus 4 uplinks.',
    ],
  ),
  e(
    'custom-field',
    'device',
    ['Trường tùy biến', 'Custom field'],
    [
      'Thông tin riêng của tổ chức gắn vào thiết bị, do admin khai báo.',
      'Organization-specific device information declared by an admin.',
    ],
    ['Trung tâm chi phí, mã hợp đồng nội bộ.', 'Cost centre, internal contract code.'],
  ),
  // --- ports ---
  e(
    'interface',
    'port',
    ['Interface (cổng)', 'Interface (port)'],
    [
      'Điểm kết nối mạng của thiết bị — cổng thật để cắm dây, hoặc cổng ảo do cấu hình tạo ra.',
      'A network connection point — a real port for a cable, or a virtual one created by configuration.',
    ],
    ['Gi1/0/1 (thật), Vlan10 (ảo).', 'Gi1/0/1 (real), Vlan10 (virtual).'],
  ),
  e(
    'media',
    'port',
    ['Media', 'Media'],
    [
      'Kiểu đầu cắm của cổng: RJ45 (dây đồng), SFP 1G / SFP+ 10G / SFP28 25G / QSFP 40–100G (module quang hoặc cáp DAC).',
      'The port connector: RJ45 (copper), SFP 1G / SFP+ 10G / SFP28 25G / QSFP 40–100G (optics or DAC).',
    ],
    ['Uplink giữa các switch thường là SFP+.', 'Switch uplinks are usually SFP+.'],
  ),
  e(
    'poe',
    'port',
    ['PoE', 'PoE'],
    [
      'Power over Ethernet: cổng cấp điện qua dây mạng cho camera, Wi-Fi AP, điện thoại IP — không cần ổ điện riêng.',
      'Power over Ethernet: the port powers cameras, Wi-Fi APs, IP phones over the network cable.',
    ],
  ),
  e(
    'svi',
    'port',
    ['SVI (Vlan interface)', 'SVI (VLAN interface)'],
    [
      'Cổng ảo đại diện cho một VLAN trên switch L3; thường mang IP quản trị của switch hoặc làm gateway của VLAN.',
      'A virtual port for a VLAN on an L3 switch; often the switch management IP or the VLAN gateway.',
    ],
    ['Vlan10 có IP 10.72.114.2/24.', 'Vlan10 has IP 10.72.114.2/24.'],
  ),
  e(
    'loopback',
    'port',
    ['Loopback', 'Loopback'],
    [
      'Cổng ảo luôn hoạt động (không phụ thuộc dây nào); router hay dùng làm IP quản trị.',
      'An always-up virtual port (no cable involved); routers often use it as the management IP.',
    ],
    ['Loopback0 = 10.255.0.1/32', 'Loopback0 = 10.255.0.1/32'],
  ),
  e(
    'tunnel',
    'port',
    ['Tunnel', 'Tunnel'],
    [
      'Đường hầm ảo nối 2 thiết bị qua Internet hoặc mạng khác, thường để VPN.',
      'A virtual link between two devices across the Internet or another network, usually a VPN.',
    ],
    ['VPN IPsec từ nhà máy về IDC.', 'An IPsec VPN from the factory to the data centre.'],
  ),
  e(
    'subinterface',
    'port',
    ['Sub-interface', 'Sub-interface'],
    [
      'Cổng con trên một cổng vật lý, mỗi cổng con xử lý một VLAN — cách router nối nhiều VLAN qua một dây ("router-on-a-stick").',
      'A child of a physical port, each handling one VLAN — how a router serves several VLANs over one cable ("router-on-a-stick").',
    ],
    ['Gi0/0.10 xử lý VLAN 10.', 'Gi0/0.10 handles VLAN 10.'],
  ),
  e(
    'lag',
    'port',
    ['LAG / Port-channel', 'LAG / port-channel'],
    [
      'Gộp nhiều cổng thật thành một đường logic (giao thức LACP): tăng băng thông, đứt một dây vẫn chạy. Các cổng thành viên nên cùng tốc độ.',
      'Several real ports bundled into one logical link (LACP): more bandwidth, survives a broken cable. Members should share a speed.',
    ],
    ['Po1 = Te1/1/1 + Te1/1/2', 'Po1 = Te1/1/1 + Te1/1/2'],
  ),
  e(
    'mac',
    'port',
    ['MAC', 'MAC'],
    [
      'Địa chỉ phần cứng duy nhất của một cổng mạng (6 byte). Dùng để tìm thiết bị đang cắm vào đâu.',
      'The unique hardware address of a network port (6 bytes). Used to find where a device is plugged in.',
    ],
    [
      'aa:bb:cc:dd:ee:ff — Cisco viết aabb.ccdd.eeff',
      'aa:bb:cc:dd:ee:ff — Cisco writes aabb.ccdd.eeff',
    ],
  ),
  e(
    'admin-up',
    'port',
    ['Bật / tắt (admin up / shutdown)', 'Admin up / shutdown'],
    [
      'Cổng đang được bật hay bị tắt bằng cấu hình. Cổng không dùng nên tắt để an toàn.',
      'Whether the port is enabled or shut down by configuration. Unused ports should be shut down.',
    ],
  ),
  // --- VLAN ---
  e(
    'link-kind',
    'port',
    ['Loại kết nối', 'Connection type'],
    [
      'Dây thật chiếm cổng vật lý, mỗi cổng một dây: Ethernet đồng (gồm DAC — cáp đồng đầu SFP), quang (gồm AOC), stack/HA, DSL, console, serial, dây nguồn. Không dây và 4G/5G không giới hạn một kết nối mỗi cổng. Logical (VPN/IPsec, GRE) không phải dây: đầu mút là interface tunnel hoặc cổng WAN mà VPN gắn vào. LAG vẽ thành từng dây vật lý giữa các cổng thành viên; MPLS là dịch vụ WAN của đường truyền.',
      'Real cables take a physical port, one per port: copper Ethernet (incl. DAC — copper with SFP ends), fibre (incl. AOC), stack/HA, DSL, console, serial, power. Wireless and 4G/5G are not limited to one link per port. Logical (VPN/IPsec, GRE) is not a cable: its ends are tunnel interfaces or the WAN port the VPN is bound to. A LAG is drawn as its member cables; MPLS is a WAN service of the line.',
    ],
    [
      'Switch Gi1/0/48 ↔ firewall port1 bằng Cat6; Te1/1/1 ↔ Te1/1/1 bằng DAC 3 m; VPN IPsec giữa tunnel VPN-HN của 2 firewall.',
      'Switch Gi1/0/48 ↔ firewall port1 over Cat6; Te1/1/1 ↔ Te1/1/1 over a 3 m DAC; an IPsec VPN between the VPN-HN tunnels of two firewalls.',
    ],
  ),
  e(
    'fiber-mode',
    'port',
    ['Quang single-mode / multi-mode, đầu nối', 'Single-mode / multi-mode fibre, connectors'],
    [
      'Single-mode (SM, vỏ vàng, đi xa hàng km) và multi-mode (MM: OM3/OM4 vỏ xanh ngọc, OM5 xanh lá — trong tòa nhà) dùng module SFP khác nhau, cắm lẫn sẽ không lên link. Đầu nối: LC (nhỏ, hay gặp ở SFP), SC (vuông, ở ODF/ONT), MPO (nhiều sợi, cho 40/100G).',
      'Single-mode (SM, yellow jacket, kilometres) and multi-mode (MM: OM3/OM4 aqua, OM5 lime — inside buildings) need different SFP modules; mixing them gives no link. Connectors: LC (small, most SFPs), SC (square, patch panels / ONTs), MPO (multi-fibre, 40/100G).',
    ],
    [
      'Uplink nhà máy ↔ văn phòng 2 km: SM, LC–LC, module 10G-LR.',
      'Factory ↔ office uplink, 2 km: SM, LC–LC, 10G-LR modules.',
    ],
  ),
  e(
    'pon',
    'port',
    ['PON, OLT, ONT, bộ chia quang', 'PON, OLT, ONT, splitter'],
    [
      'Mạng quang thụ động (GPON/XGS-PON): một cổng PON của OLT qua bộ chia quang (splitter) tới nhiều ONT ở từng phòng/nhà. Nhà mạng dùng cho FTTH; doanh nghiệp dùng mạng POL nội bộ. Cổng PON vì vậy nối được nhiều dây.',
      'Passive optical network (GPON/XGS-PON): one OLT PON port feeds many ONTs through a passive splitter. Carriers use it for FTTH; companies for in-house POL networks. A PON port therefore takes many links.',
    ],
    [
      'OLT pon0/1 → splitter 1:32 → ONT ở 32 phòng ký túc xá.',
      'OLT pon0/1 → 1:32 splitter → ONTs in 32 dorm rooms.',
    ],
  ),
  e(
    'wan-service',
    'port',
    ['Dịch vụ WAN', 'WAN service'],
    [
      'Loại đường truyền nhà mạng: Internet FTTH (dùng chung, IP động), Internet trực tiếp (IP tĩnh, cam kết SLA), MPLS VPN (mạng riêng nối các chi nhánh), kênh thuê riêng (điểm–điểm), Metro Ethernet, 4G/5G. Ghi kèm nhà mạng, mã circuit, băng thông để báo sự cố nhanh.',
      'The kind of carrier line: broadband FTTH (shared, dynamic IP), dedicated Internet (static IP, SLA), MPLS VPN (private network between branches), leased line (point to point), Metro Ethernet, 4G/5G. Record carrier, circuit ID and bandwidth to report outages quickly.',
    ],
    [
      'FW01 wan1 → Internet: Internet trực tiếp VNPT, circuit HCM-123, 200 Mbps; wan2 → 4G Viettel dự phòng.',
      'FW01 wan1 → Internet: dedicated Internet from VNPT, circuit HCM-123, 200 Mbps; wan2 → Viettel 4G backup.',
    ],
  ),
  e(
    'power-stack-link',
    'port',
    ['Dây nguồn, dây stack/HA', 'Power cords, stack / HA cables'],
    [
      'Dây nguồn nối UPS/PDU tới thiết bị (thiết bị 2 nguồn có 2 dây) — biết thiết bị nào tắt khi một UPS hỏng. Dây stack/HA nối các thành viên một cụm: cáp stack của switch, dây heartbeat giữa 2 firewall HA.',
      'Power cords run from a UPS/PDU to a device (two cords for two PSUs) — so you know what goes down when a UPS fails. Stack/HA cables join cluster members: switch stacking cables, the heartbeat between two HA firewalls.',
    ],
    [
      'UPS01 outlet1 → CORE01 PSU1, UPS02 outlet1 → CORE01 PSU2; FW01 ha ↔ FW02 ha.',
      'UPS01 outlet1 → CORE01 PSU1, UPS02 outlet1 → CORE01 PSU2; FW01 ha ↔ FW02 ha.',
    ],
  ),
  e(
    'provider-cloud',
    'device',
    ['Internet / mạng nhà cung cấp', 'Internet / carrier network'],
    [
      'Hình đám mây đại diện Internet hoặc mạng MPLS của nhà mạng — đầu bên kia của đường WAN. Không phải tài sản: luôn "bên ngoài", tên đặt tự do và được trùng (vẽ nhiều đám mây "Internet" trên các sơ đồ).',
      'A cloud standing for the Internet or a carrier MPLS network — the far end of a WAN line. Not an asset: always external, freely named and may repeat (many "Internet" clouds across diagrams).',
    ],
    [
      'Modem MDM01 → (DSL) → đám mây "Internet VNPT".',
      'Modem MDM01 → (DSL) → the "Internet VNPT" cloud.',
    ],
  ),
  e(
    'vlan',
    'vlan',
    ['VLAN', 'VLAN'],
    [
      'Chia một switch (hoặc cả hệ thống switch) thành nhiều mạng riêng, mỗi mạng có số 1–4094. Thiết bị khác VLAN không nói chuyện trực tiếp được.',
      'Splits switches into separate networks numbered 1–4094. Devices in different VLANs cannot talk directly.',
    ],
    [
      'VLAN 10 quản trị, VLAN 20 camera, VLAN 30 văn phòng.',
      'VLAN 10 management, VLAN 20 cameras, VLAN 30 office.',
    ],
  ),
  e(
    'access',
    'vlan',
    ['Cổng access', 'Access port'],
    [
      'Cổng mang đúng 1 VLAN — dùng để cắm thiết bị đầu cuối (PC, camera, máy in).',
      'A port carrying exactly one VLAN — for end devices (PCs, cameras, printers).',
    ],
    ['Cổng cắm camera: access VLAN 20.', 'Camera port: access VLAN 20.'],
  ),
  e(
    'trunk',
    'vlan',
    ['Cổng trunk', 'Trunk port'],
    [
      'Cổng mang nhiều VLAN cùng lúc (mỗi gói gắn nhãn VLAN) — dùng nối switch–switch, switch–firewall, switch–AP.',
      'A port carrying many VLANs at once (each frame tagged) — switch–switch, switch–firewall, switch–AP links.',
    ],
    ['Uplink: trunk, cho phép VLAN 10,20,30.', 'Uplink: trunk allowing VLANs 10,20,30.'],
  ),
  e(
    'allowed-vlans',
    'vlan',
    ['VLAN cho phép', 'Allowed VLANs'],
    ['Trên cổng trunk: danh sách VLAN được đi qua.', 'On a trunk: the VLANs allowed through.'],
    ['10,20-30', '10,20-30'],
  ),
  e(
    'native-vlan',
    'vlan',
    ['Native VLAN', 'Native VLAN'],
    [
      'Trên cổng trunk: VLAN đi mà không gắn nhãn (mặc định VLAN 1). Hai đầu trunk phải giống nhau.',
      'On a trunk: the VLAN sent untagged (VLAN 1 by default). Both ends must match.',
    ],
  ),
  e(
    'dot1q',
    'vlan',
    ['802.1Q (dot1q, VLAN tag)', '802.1Q (dot1q, VLAN tag)'],
    [
      'Chuẩn gắn nhãn VLAN vào gói tin khi đi trên trunk; sub-interface khai báo nó xử lý tag nào.',
      'The standard that tags frames with their VLAN on trunks; a sub-interface states which tag it handles.',
    ],
    ['Gi0/0.10 → dot1q 10', 'Gi0/0.10 → dot1q 10'],
  ),
  e(
    'mode',
    'vlan',
    ['Mode của cổng', 'Port mode'],
    [
      'Access: 1 VLAN. Trunk: nhiều VLAN. Routed: cổng có IP như cổng router, không thuộc VLAN nào. Hybrid: kiểu riêng của một số hãng (trộn access + trunk).',
      "Access: one VLAN. Trunk: many VLANs. Routed: the port has an IP like a router port. Hybrid: some vendors' mix of access and trunk.",
    ],
  ),
  // --- IP ---
  e(
    'ip',
    'ip',
    ['Địa chỉ IP', 'IP address'],
    [
      'Địa chỉ của một cổng trên mạng, dạng 4 số (IPv4) hoặc dài hơn (IPv6).',
      'The address of a port on the network: four numbers (IPv4) or longer (IPv6).',
    ],
    ['10.72.114.2', '10.72.114.2'],
  ),
  e(
    'cidr',
    'ip',
    ['CIDR / prefix (/24)', 'CIDR / prefix (/24)'],
    [
      'Cách ghi IP kèm độ lớn mạng: số sau dấu / là số bit phần mạng. /24 = 256 địa chỉ (mặt nạ 255.255.255.0), /30 = 4 địa chỉ (đường nối 2 thiết bị), /32 = đúng 1 địa chỉ.',
      'IP plus network size: the number after / is the network bits. /24 = 256 addresses (255.255.255.0), /30 = 4 (a point-to-point link), /32 = one address.',
    ],
    ['10.72.114.2/24 thuộc mạng 10.72.114.0/24.', '10.72.114.2/24 belongs to 10.72.114.0/24.'],
  ),
  e(
    'subnet',
    'ip',
    ['Subnet', 'Subnet'],
    [
      'Một dải mạng (vd mỗi VLAN một subnet). IPAM theo dõi subnet nào đã dùng bao nhiêu IP.',
      'A network range (e.g. one per VLAN). IPAM tracks how much of each subnet is used.',
    ],
    ['10.72.114.0/24 cho VLAN 10.', '10.72.114.0/24 for VLAN 10.'],
  ),
  e(
    'network-broadcast',
    'ip',
    ['Địa chỉ mạng / broadcast', 'Network / broadcast address'],
    [
      'Địa chỉ đầu và cuối của một subnet IPv4 — không gán cho thiết bị (trừ /31, /32).',
      'The first and last address of an IPv4 subnet — not assigned to devices (except /31, /32).',
    ],
    ['Với 10.72.114.0/24: .0 và .255.', 'For 10.72.114.0/24: .0 and .255.'],
  ),
  e(
    'gateway',
    'ip',
    ['Gateway', 'Gateway'],
    [
      'Thiết bị (thường firewall/router hoặc SVI) chuyển gói ra khỏi subnet; thường dùng IP .1.',
      'The device (firewall/router or SVI) that forwards traffic out of the subnet; usually the .1 address.',
    ],
    ['10.72.114.1 trên firewall.', '10.72.114.1 on the firewall.'],
  ),
  e(
    'ipam',
    'ip',
    ['IPAM', 'IPAM'],
    [
      'IP Address Management — sổ quy hoạch địa chỉ IP: mạng nào dùng cho việc gì, còn bao nhiêu IP trống, IP nào đang thuộc thiết bị nào. Giúp tránh gán trùng IP.',
      'IP Address Management — the address plan: which network is for what, how many addresses are free, which device holds which IP. Prevents duplicate assignments.',
    ],
    [
      'Trước khi lắp camera mới, mở subnet camera → "Tìm IP trống" → được 10.72.120.15.',
      'Before installing a camera, open the camera subnet → "Find a free IP" → 10.72.120.15.',
    ],
  ),
  e(
    'ip-range',
    'ip',
    ['Dải IP (quy hoạch)', 'IP range (plan)'],
    [
      'Chia một subnet thành các khúc theo mục đích: DHCP (máy chủ DHCP tự cấp), IP tĩnh (đặt tay cho server, camera…), dành riêng (giữ lại, không cấp).',
      'Splits a subnet into blocks by purpose: DHCP (handed out by the DHCP server), static (set by hand for servers, cameras…), reserved (kept back).',
    ],
    [
      '10.72.114.0/24: .2–.49 tĩnh cho thiết bị mạng, .100–.200 DHCP cho máy trạm, .250–.254 dành riêng.',
      '10.72.114.0/24: .2–.49 static for network gear, .100–.200 DHCP for clients, .250–.254 reserved.',
    ],
  ),
  e(
    'next-free',
    'ip',
    ['IP trống kế tiếp', 'Next free IP'],
    [
      'IP đầu tiên trong subnet chưa ai dùng: bỏ qua gateway, IP của mọi thiết bị (cùng VRF), IP quản trị cụm, dải DHCP và dải dành riêng.',
      'The first unused address of a subnet: skips the gateway, every device address (same VRF), cluster management IPs, DHCP and reserved ranges.',
    ],
    [
      'Form IP thiết bị → "Lấy IP trống từ subnet" → tự điền 10.72.114.11/24.',
      'Device IP form → "Take a free IP from subnet" → fills in 10.72.114.11/24.',
    ],
  ),
  e(
    'dhcp',
    'ip',
    ['DHCP', 'DHCP'],
    [
      'Dịch vụ tự cấp IP cho máy tính, điện thoại khi cắm mạng / vào Wi-Fi, thường chạy trên firewall hoặc server. IP trong dải DHCP không nên gán tay để tránh trùng.',
      'The service that hands out IPs automatically to PCs and phones joining the network, usually on the firewall or a server. Do not hand-assign addresses inside a DHCP pool.',
    ],
    [
      'Firewall cấp 10.72.114.100–200 cho laptop nhân viên.',
      'The firewall hands 10.72.114.100–200 to staff laptops.',
    ],
  ),
  e(
    'ip-role',
    'ip',
    ['Vai trò IP', 'IP role'],
    [
      'Chính: IP chính của cổng (mỗi IPv4/IPv6 một cái). Phụ: IP thêm trên cùng cổng. NAT: IP mà thiết bị được nhìn thấy sau khi đổi địa chỉ. Public: IP Internet để vào thiết bị từ xa. VIP: IP gateway ảo dùng chung của nhóm VRRP/HSRP.',
      "Primary: the port's main IP (one per IPv4/IPv6). Secondary: extra IP on the port. NAT: the address the device appears as after translation. Public: the Internet IP used to reach it. VIP: the shared virtual gateway IP of a VRRP/HSRP group.",
    ],
  ),
  e(
    'vpn',
    'ip',
    ['VPN site-to-site / VPN client', 'Site-to-site VPN / client VPN'],
    [
      'Đường hầm mã hóa qua Internet. Site-to-site: hai firewall (chi nhánh ↔ trụ sở) nối cố định với nhau, máy hai bên thấy nhau như cùng một mạng. Client (remote access): nhân viên cài phần mềm VPN trên laptop để vào mạng công ty khi ở ngoài.',
      'An encrypted tunnel over the Internet. Site-to-site: two firewalls (branch ↔ head office) stay connected, hosts on both sides reach each other as one network. Client (remote access): staff run a VPN app on their laptop to reach the office network from outside.',
    ],
    [
      'Chi nhánh Đà Nẵng ↔ trụ sở HCM qua IPsec; nhân viên đi công tác dùng FortiClient.',
      'Da Nang branch ↔ HCM head office over IPsec; travelling staff use FortiClient.',
    ],
  ),
  e(
    'vrrp',
    'ip',
    ['VIP / VRRP / HSRP (gateway dự phòng)', 'VIP / VRRP / HSRP (gateway redundancy)'],
    [
      'Hai router (hoặc core switch) cùng làm gateway cho một mạng: mỗi máy có IP riêng và cùng chia một IP ảo (VIP). Máy tính đặt gateway là IP ảo; máy nào đang chạy thì giữ IP đó, một máy hỏng máy kia nhận thay. VRRP là chuẩn chung, HSRP là của Cisco. Trong hệ thống: khai IP ảo trên cả hai thiết bị với vai trò VIP — đây là trường hợp duy nhất một IP được phép trùng giữa hai thiết bị khác cụm.',
      "Two routers (or core switches) act as the gateway of one network: each has its own IP and they share one virtual IP (VIP). Hosts use the VIP as gateway; whichever unit is up holds it, the other takes over on failure. VRRP is the standard, HSRP is Cisco's. Here: add the VIP on both devices with role VIP — the one case where an address may repeat across devices outside a cluster.",
    ],
    [
      'CORE1 10.0.10.2, CORE2 10.0.10.3, VIP 10.0.10.1 (gateway của VLAN 10) trên cả hai.',
      'CORE1 10.0.10.2, CORE2 10.0.10.3, VIP 10.0.10.1 (gateway of VLAN 10) on both.',
    ],
  ),
  e(
    'mgmt-ip',
    'ip',
    ['IP quản trị / interface quản trị', 'Management IP / interface'],
    [
      'IP kỹ sư dùng để SSH hoặc mở web vào thiết bị. Trong hệ thống: chọn interface quản trị, IP quản trị = IP chính của interface đó (không gõ tay).',
      'The IP engineers SSH or browse to. Here: pick the management interface; the management IP is its primary IP (never typed).',
    ],
    [
      'Switch Cisco quản trị qua Vlan10; FortiGate qua cổng mgmt; router qua Loopback0.',
      'Cisco switch via Vlan10; FortiGate via its mgmt port; router via Loopback0.',
    ],
  ),
  e(
    'nat',
    'ip',
    ['NAT', 'NAT'],
    [
      'Đổi địa chỉ khi gói đi qua firewall/router: thiết bị bên trong được nhìn thấy bằng IP khác (thường IP public).',
      'Address translation at the firewall/router: an inside device appears with another (usually public) IP.',
    ],
    [
      'Camera 10.72.120.5 được truy cập qua 203.0.113.10:8080.',
      'Camera 10.72.120.5 reached via 203.0.113.10:8080.',
    ],
  ),
  e(
    'vrf',
    'ip',
    ['VRF', 'VRF'],
    [
      'Bảng định tuyến riêng trên cùng một thiết bị, tách các mạng không được thấy nhau. Cùng một IP ở 2 VRF khác nhau là hợp lệ. Không dùng thì để trống.',
      'A separate routing table on one device keeping networks apart. The same IP in two VRFs is valid. Leave empty if unused.',
    ],
    [
      'Hai khách cùng dùng 192.168.1.0/24 trên một router MPLS.',
      'Two customers both using 192.168.1.0/24 on one MPLS router.',
    ],
  ),
  e(
    'poll-address',
    'ip',
    ['Địa chỉ poll', 'Poll address'],
    [
      'Địa chỉ hệ thống giám sát (Phase 3) dùng để hỏi trạng thái thiết bị. Để trống = dùng IP quản trị; điền khi phải đi đường khác (vd qua NAT).',
      'The address monitoring (Phase 3) polls. Empty = the management IP; set it when polling must go another way (e.g. via NAT).',
    ],
  ),
  // --- clusters ---
  e(
    'cluster',
    'cluster',
    ['Cụm thiết bị', 'Device cluster'],
    [
      'Nhiều thiết bị vật lý chạy như một thiết bị (dự phòng hoặc ghép). Mỗi con vẫn có S/N, bảo hành riêng. Không bắt buộc — đa số thiết bị đứng lẻ.',
      'Several physical devices working as one (redundancy or stacking). Each keeps its own S/N and warranty. Optional — most devices stand alone.',
    ],
  ),
  e(
    'ha',
    'cluster',
    ['HA (High Availability)', 'HA (high availability)'],
    [
      'Active-passive: một con chạy, một con chờ, con chính hỏng thì con kia tự nhận việc. Active-active: cả hai cùng chạy, chia tải. Thường chung IP quản trị và cấu hình.',
      'Active-passive: one runs, one waits and takes over on failure. Active-active: both run and share load. Usually a shared management IP and config.',
    ],
    ['Cặp FortiGate HA ở IDC.', 'An HA pair of FortiGates in the data centre.'],
  ),
  e(
    'stack',
    'cluster',
    ['Stack', 'Stack'],
    [
      'Nhiều switch nối bằng cáp stack, cấu hình và quản lý như một switch lớn: chung hostname, chung IP; cổng đánh số theo thành viên (Gi1/0/x, Gi2/0/x…).',
      'Switches joined by stack cables and managed as one big switch: shared hostname and IP; ports numbered per member (Gi1/0/x, Gi2/0/x…).',
    ],
    ['3 × Cisco C9300 thành một switch 144 cổng.', '3 × Cisco C9300 as one 144-port switch.'],
  ),
  e(
    'vpc-vss',
    'cluster',
    ['vPC / VSS', 'vPC / VSS'],
    [
      'Cách ghép 2 switch core của Cisco: vPC (Nexus) — 2 switch riêng, thiết bị bên dưới cắm LAG sang cả hai; VSS (Catalyst) — 2 switch gộp thành 1 switch logic.',
      'Cisco ways to pair two core switches: vPC (Nexus) — two separate switches with LAGs to both; VSS (Catalyst) — two switches merged into one logical switch.',
    ],
  ),
  e(
    'cluster-ip',
    'cluster',
    ['IP quản trị cụm', 'Cluster management IP'],
    [
      'IP chung của cả cụm (vd IP của cặp HA hoặc của stack), không nằm trên interface nào của một thành viên; IPAM vẫn tính là đang dùng.',
      "The cluster's shared address (an HA pair's or a stack's IP), on no single member's interface; IPAM still counts it as used.",
    ],
    ['Stack core BD dùng 10.72.114.3.', 'The BD core stack uses 10.72.114.3.'],
  ),
  e(
    'endpoint-group',
    'device',
    ['Nhóm thiết bị đầu cuối', 'Endpoint group'],
    [
      'Nhiều thiết bị giống nhau (camera, PC, điện thoại IP…) gom thành một mục: một dải IP, số lượng dự kiến, danh sách thành viên (tên, IP, MAC, cổng switch). Trên sơ đồ là một biểu tượng kèm "đã dùng/tổng". Thành viên cần quản lý riêng thì tách thành thiết bị.',
      'Many similar devices (cameras, PCs, IP phones…) kept as one item: an IP range, an expected count, members (name, IP, MAC, switch port). Drawn as one icon with "used/total"; a member that needs its own record is split off as a device.',
    ],
    [
      '"Camera nhà xưởng": 20 camera, dải 10.72.120.2–21, đang có 14 → 14/20.',
      '"Factory cameras": 20 cameras, range 10.72.120.2–21, 14 in use → 14/20.',
    ],
  ),
  e(
    'member-no',
    'cluster',
    ['Số thứ tự thành viên', 'Member number'],
    [
      'Vị trí của thiết bị trong cụm (1, 2, 3…). Với stack, số này cũng là số đầu trong tên cổng (Gi2/0/1 là cổng của thành viên 2).',
      "The device's position in the cluster (1, 2, 3…). For a stack it is also the first number of port names (Gi2/0/1 is on member 2).",
    ],
  ),
  // --- organization ---
  e(
    'site',
    'org',
    ['Site', 'Site'],
    [
      'Một địa điểm vật lý rõ ràng có địa chỉ (văn phòng, nhà máy, IDC). Mã site tự ghép: mã tổ chức + mã các danh mục + mã riêng của site.',
      'A physical place with an address (office, factory, data centre). Its code is built from the organization code, the category codes and its own code.',
    ],
    [
      'CJ-AGRI-BD01 = nhà máy số 1 ở Bình Định thuộc danh mục AGRI của tổ chức CJ.',
      'CJ-AGRI-BD01 = the first Binh Dinh factory in category AGRI of organization CJ.',
    ],
  ),
  e(
    'location',
    'org',
    ['Location', 'Location'],
    [
      'Vị trí bên trong site: tòa nhà → tầng → phòng. Không bắt buộc với site nhỏ.',
      'Places inside a site: building → floor → room. Optional for small sites.',
    ],
  ),
  e(
    'frame',
    'org',
    ['Khung site / location', 'Site / location frame'],
    [
      'Hình chữ nhật trên sơ đồ gom các thiết bị của một site (vd "FPT IDC") hoặc một location (tòa, tầng, phòng). Tên khung lấy theo site/location. Thiết bị mới thả vào khung nhận site/location đó; thiết bị có sẵn mà site thật khác khung sẽ bị cảnh báo, không tự sửa kho. Cụm HA/stack được vẽ khung chấm tự động.',
      'A rectangle on the diagram grouping the devices of a site (e.g. "FPT IDC") or a location (building, floor, room), named after it. New devices dropped inside get that site/location; an existing device whose real site differs is flagged, the inventory is never changed. HA pairs / stacks get a dotted box automatically.',
    ],
    [
      'Khung "HCMC Site" chứa 4 switch; khung "FPT IDC" chứa cặp FortiGate HA.',
      'A "HCMC Site" frame with 4 switches; a "FPT IDC" frame with the FortiGate HA pair.',
    ],
  ),
  e(
    'category',
    'org',
    ['Danh mục', 'Category'],
    [
      'Nhánh để chia việc quản lý trong tổ chức: công ty con, khách hàng của khách, chi nhánh, bộ phận… Chia bao nhiêu cấp cũng được; site gắn vào danh mục nào cũng được, hoặc gắn thẳng vào tổ chức. Mã danh mục nằm trong mã site.',
      'A branch to split management inside the organization: subsidiaries, customers of a customer, branches, departments… As many levels as needed; a site can hang under any category or straight under the organization. Category codes are part of site codes.',
    ],
    [
      'Tổ chức CJ → danh mục CJ Feed (CJFEED) → site HCM = CJ-CJFEED-HCM.',
      'Organization CJ → category CJ Feed (CJFEED) → site HCM = CJ-CJFEED-HCM.',
    ],
  ),
]

export const GLOSSARY_BY_ID = new Map(GLOSSARY.map((g) => [g.id, g]))
