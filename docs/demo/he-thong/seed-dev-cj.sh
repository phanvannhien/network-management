#!/bin/zsh
# Nạp dữ liệu mẫu CJ Foodville (docs/demo) vào tổ chức CJ trên máy dev, qua API với phiên đăng nhập của chính bạn.
# Dùng lại danh mục FOODVILLE, 3 site CJ-FOODVILLE-HCM01 (FPT IDC) / HAN01 / HOC01, 2 thiết bị đã có; chỉ thêm phần thiếu.
# Cách chạy:  NTB_SESSION='<giá trị cookie ntb_session>' zsh docs/demo/he-thong/seed-dev-cj.sh
# (Lấy cookie: mở http://localhost:5173 đã đăng nhập → DevTools → Application → Cookies → ntb_session.)
set -e
B=${NTB_URL:-http://localhost:5173}/api
[ -n "$NTB_SESSION" ] || { echo "Thiếu NTB_SESSION"; exit 1; }
CSRF=$(curl -sf "$B/auth/me" -H "Cookie: ntb_session=$NTB_SESSION" | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
p() { curl -s -X "$1" "$B$2" -H "Cookie: ntb_session=$NTB_SESSION" -H "X-CSRF-Token: $CSRF" -H "Origin: ${NTB_URL:-http://localhost:5173}" -H "Content-Type: application/json" ${3:+-d "$3"}; }
j() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
OC=${NTB_ORG_CODE:-CJ}
# The list has no codes: find the organization whose code matches.
ORG=""
for o in $(p GET /orgs | j "print(' '.join(o['id'] for o in d['organizations']))"); do
  [ "$(p GET /orgs/$o | j "print(d['organization']['code'])")" = "$OC" ] && ORG=$o
done
[ -n "$ORG" ] || { echo "Không thấy tổ chức mã $OC"; exit 1; }
echo "Tổ chức $OC: $ORG"
site() { p GET /orgs/$ORG/sites | j "print([s['id'] for s in d['sites'] if s['code']=='$1'][0])"; }
IDC=$(site $OC-FOODVILLE-HCM01); HN=$(site $OC-FOODVILLE-HAN01); HCM=$(site $OC-FOODVILLE-HOC01)
tpl() { # name, json
  local t=$(p GET /orgs/$ORG/device-templates | j "print(next((t['id'] for t in d['templates'] if t['name']=='$1'),''))")
  [ -n "$t" ] && echo $t || p POST /orgs/$ORG/device-templates "$2" | j "print(d['id'])"; }
T_FG=$(tpl 'Fortinet FortiGate 8F' '{}')
T_ISR=$(tpl 'Cisco ISR4331' '{"name":"Cisco ISR4331","type":"router","vendor":"Cisco","model":"ISR4331","partNumber":"ISR4331/K9","ports":[{"pattern":"GigabitEthernet0/0/{n}","start":0,"count":3,"media":"RJ45","speed":"1G"}]}')
T_CBS=$(tpl 'Cisco CBS220-24T-4G' '{"name":"Cisco CBS220-24T-4G","type":"l2_switch","vendor":"Cisco","model":"CBS220-24T-4G","partNumber":"CBS220-24T-4G","ports":[{"pattern":"GigabitEthernet{n}","start":1,"count":24,"media":"RJ45","speed":"1G"},{"pattern":"GigabitEthernet{n}","start":25,"count":4,"media":"SFP","speed":"1G"}]}')
T_C13=$(tpl 'Cisco C1300-24T-4G' '{"name":"Cisco C1300-24T-4G","type":"l2_switch","vendor":"Cisco","model":"C1300-24T-4G","partNumber":"C1300-24T-4G","ports":[{"pattern":"GigabitEthernet1/0/{n}","start":1,"count":24,"media":"RJ45","speed":"1G"},{"pattern":"GigabitEthernet1/0/{n}","start":25,"count":4,"media":"SFP","speed":"1G"}]}')
devid() { p GET "/orgs/$ORG/devices?q=$1&pageSize=50" | j "print(next((x['id'] for x in d['devices'] if x['hostname']=='$1'),''))"; }
# Cụm HA ở IDC
CL=$(p GET /orgs/$ORG/clusters | j "print(next((c['id'] for c in d['clusters'] if c['name']=='CJIDC-HA'),''))")
[ -n "$CL" ] || CL=$(p POST /orgs/$ORG/clusters "{\"kind\":\"ha_active_passive\",\"name\":\"CJIDC-HA\",\"hostname\":\"VPN_CJIDC\",\"mgmtIp\":\"10.136.4.101/24\",\"siteId\":\"$IDC\"}" | j "print(d['id'])")
# Thiết bị đã có: cập nhật theo Excel (ISR về site HaNoi), sinh cổng theo template
upd() { # id, python patch
  local V=$(p GET /orgs/$ORG/devices/$1 | j "$2;print(json.dumps(d))"); p PATCH /orgs/$ORG/devices/$1 "$V" | j "print('cập nhật', d.get('hostname', d))"; }
FW1=$(devid VPN_CJIDC); ISR=$(devid ISR4331_VN_FV_HanoiOffice_41.1)
upd $FW1 "d.update(serialNumber='FGT80FTK22027891',vendor='Fortinet',model='FortiGate 80F',partNumber='FG-80F',role='edge',siteId='$IDC',clusterId='$CL',clusterRole='primary',clusterMemberNo=1,ownerName='GVN')"
upd $ISR "d.update(serialNumber='FDO2623M1CH',vendor='Cisco',model='ISR4331',partNumber='ISR4331/K9',role='edge',siteId='$HN',ownerName='GVN')"
p POST /orgs/$ORG/devices/$FW1/apply-template "{\"templateId\":\"$T_FG\"}" >/dev/null
p POST /orgs/$ORG/devices/$ISR/apply-template "{\"templateId\":\"$T_ISR\"}" >/dev/null
dev() { local x=$(devid $1); [ -n "$x" ] && echo $x || p POST /orgs/$ORG/devices "$2" | j "print(d['id'])"; }
FW2=$(dev CJIDC_HA_Slaver "{\"hostname\":\"CJIDC_HA_Slaver\",\"type\":\"firewall\",\"siteId\":\"$IDC\",\"templateId\":\"$T_FG\",\"vendor\":\"Fortinet\",\"model\":\"FortiGate 80F\",\"partNumber\":\"FG-80F\",\"serialNumber\":\"FGT80FTK22027966\",\"role\":\"edge\",\"clusterId\":\"$CL\",\"clusterRole\":\"member\",\"clusterMemberNo\":2,\"ownerName\":\"GVN\"}")
CBS=$(dev CSB220_VN_FV_HanoiOffice_41.2 "{\"hostname\":\"CSB220_VN_FV_HanoiOffice_41.2\",\"type\":\"l2_switch\",\"siteId\":\"$HN\",\"templateId\":\"$T_CBS\",\"serialNumber\":\"DNI2551013J\",\"role\":\"access\",\"ownerName\":\"GVN\"}")
sw() { dev c1300-vn-foodville-hcm-162-$1 "{\"hostname\":\"c1300-vn-foodville-hcm-162-$1\",\"type\":\"l2_switch\",\"siteId\":\"$HCM\",\"templateId\":\"$T_C13\",\"serialNumber\":\"$2\",\"role\":\"$3\",\"ownerName\":\"GVN\"}"; }
S4=$(sw 4 DNI284102TL core); S5=$(sw 5 DNI284102NG access); S6=$(sw 6 DNI274501MP access); S7=$(sw 7 DNI274502EX access)
NET_HN=$(dev Internet-HaNoi "{\"hostname\":\"Internet-HaNoi\",\"type\":\"provider_cloud\",\"siteId\":\"$HN\"}")
NET_HQ=$(dev HCMC-HQ "{\"hostname\":\"HCMC-HQ\",\"type\":\"provider_cloud\",\"siteId\":\"$HCM\"}")
ifid() { p GET /orgs/$ORG/devices/$1/interfaces | j "print(next((i['id'] for i in d['interfaces'] if i['name']=='$2'),''))"; }
iface() { local x=$(ifid $1 $2); [ -n "$x" ] && echo $x || p POST /orgs/$ORG/devices/$1/interfaces "{\"name\":\"$2\",\"kind\":\"$3\"}" | j "print(d['id'])"; }
ip() { p POST /orgs/$ORG/devices/$1/ips "{\"interfaceId\":\"$2\",\"address\":\"$3\",\"role\":\"primary\"${4:+,\"description\":\"$4\"}}" >/dev/null; }
mgmt() { ip $1 $2 $3; upd $1 "d['mgmtInterfaceId']='$2'" >/dev/null; }
mgmt $ISR $(iface $ISR GigabitEthernet0/0/1 physical) 10.136.41.1/24
mgmt $CBS $(iface $CBS Vlan1 svi) 10.136.41.2/24
mgmt $S4 $(iface $S4 Vlan1 svi) 10.136.162.4/24; mgmt $S5 $(iface $S5 Vlan1 svi) 10.136.162.5/24
mgmt $S6 $(iface $S6 Vlan1 svi) 10.136.162.6/24; mgmt $S7 $(iface $S7 Vlan1 svi) 10.136.162.7/24
ip $ISR $(iface $ISR GigabitEthernet0/0/0 physical) 27.72.96.43/30 WAN
T1=$(iface $ISR Tunnel1 tunnel); T2=$(iface $ISR Tunnel2 tunnel)
ip $ISR $T1 10.136.255.166/30 VPN-VN_FV_HanoiOffice-Active; ip $ISR $T2 10.136.255.170/30 VPN-VN_FV_HanoiOffice-Backup
FT1=$(iface $FW1 VPN-HN-A tunnel); FT2=$(iface $FW1 VPN-HN-B tunnel)
ep() { if [ -n "$2" ]; then echo "{\"kind\":\"device\",\"id\":\"$1\",\"interfaceId\":\"$2\"}"; else echo "{\"kind\":\"device\",\"id\":\"$1\"}"; fi; }
lnk() { p POST /orgs/$ORG/links "$1" | j "print('dây', d.get('kind', d.get('message', d)))"; }
lnk "{\"a\":$(ep $FW1),\"b\":$(ep $FW2),\"kind\":\"stack\",\"medium\":\"HA heartbeat\"}"
lnk "{\"a\":$(ep $NET_HN),\"b\":$(ep $ISR $(ifid $ISR GigabitEthernet0/0/0)),\"kind\":\"ethernet\",\"service\":\"internet_dedicated\",\"notes\":\"WAN 27.72.96.43\"}"
lnk "{\"a\":$(ep $ISR $(ifid $ISR GigabitEthernet0/0/1)),\"b\":$(ep $CBS $(ifid $CBS GigabitEthernet2)),\"kind\":\"ethernet\",\"medium\":\"Cat6\",\"notes\":\"10.136.41.0/24\"}"
lnk "{\"a\":$(ep $ISR $T1),\"b\":$(ep $FW1 $FT1),\"kind\":\"logical\",\"medium\":\"VPN/IPsec\",\"notes\":\"VPN-VN_FV_HanoiOffice-Active\"}"
lnk "{\"a\":$(ep $ISR $T2),\"b\":$(ep $FW1 $FT2),\"kind\":\"logical\",\"medium\":\"VPN/IPsec\",\"notes\":\"VPN-VN_FV_HanoiOffice-Backup\"}"
lnk "{\"a\":$(ep $NET_HQ),\"b\":$(ep $S4),\"kind\":\"ethernet\"}"
for pr in "23 $S7" "22 $S6" "21 $S5"; do set -- ${=pr}; lnk "{\"a\":$(ep $S4 $(ifid $S4 GigabitEthernet1/0/$1)),\"b\":$(ep $2 $(ifid $2 GigabitEthernet1/0/24)),\"kind\":\"ethernet\",\"medium\":\"Cat6\"}"; done
# Sơ đồ mới (không đụng "Topology Foodville" của bạn)
DG=$(p POST /orgs/$ORG/diagrams '{"name":"Foodville — dữ liệu mẫu","layer":"physical"}' | j "print(d['diagram']['id'])")
V=$(python3 -c "
import json
pos={'$NET_HQ':(300,0),'$S4':(300,160),'$S7':(40,360),'$S6':(300,360),'$S5':(560,360),'$FW1':(300,620),'$FW2':(300,800),
     '$NET_HN':(900,0),'$ISR':(900,180),'$CBS':(900,460)}
print(json.dumps({'version':1,'view':{'nodes':[{'id':'n%d'%i,'refKind':'device','refId':k,'x':v[0],'y':v[1]} for i,(k,v) in enumerate(pos.items())],'edges':[],'annotations':[]},'changes':[]}))")
p POST /orgs/$ORG/diagrams/$DG/save "$V" | j "print('sơ đồ', d['detail']['diagram']['name'])"
echo "Xong. Mở: ${NTB_URL:-http://localhost:5173}/o/$ORG/diagrams/$DG"
