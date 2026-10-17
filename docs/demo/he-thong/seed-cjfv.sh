#!/bin/zsh
# CJ Foodville demo (docs/demo): category FV, sites IDC / HN01 / HCM01, 8 devices + 2 provider clouds, HA cluster, cables, diagram.
TOK=$(python3 -c "import json;print(json.load(open('/tmp/ui-tokens.json'))['full'])"); B=http://localhost:5180/api; ORG=11111111-1111-4111-8111-111111111111
p() { curl -s -X "$1" "$B$2" -H "Cookie: ntb_session=$TOK" -H "X-CSRF-Token: c1" -H "Origin: http://localhost:5180" -H "Content-Type: application/json" ${3:+-d "$3"}; }
id() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d['id'] if 'id' in d else d)"; }
FV=$(p POST /orgs/$ORG/categories '{"code":"FV","name":"CJ Foodville","contactName":"GVN"}' | id)
IDC=$(p POST /orgs/$ORG/sites "{\"code\":\"IDC\",\"name\":\"FPT IDC HCM\",\"kind\":\"datacenter\",\"categoryId\":\"$FV\",\"isp\":\"FPT Telecom\"}" | id)
HN=$(p POST /orgs/$ORG/sites "{\"code\":\"HN01\",\"name\":\"Văn phòng Hà Nội\",\"kind\":\"office\",\"categoryId\":\"$FV\"}" | id)
HCM=$(p POST /orgs/$ORG/sites "{\"code\":\"HCM01\",\"name\":\"Văn phòng Hồ Chí Minh (HQ)\",\"kind\":\"office\",\"categoryId\":\"$FV\"}" | id)
tpl() { p POST /orgs/$ORG/device-templates "$1" | id; }
T_FG=$(tpl '{"name":"FortiGate 80F","type":"firewall","vendor":"Fortinet","model":"FortiGate 80F","partNumber":"FG-80F","ports":[{"pattern":"wan{n}","start":1,"count":2,"media":"RJ45","speed":"1G"},{"pattern":"internal{n}","start":1,"count":6,"media":"RJ45","speed":"1G"},{"pattern":"a","start":1,"count":1,"media":"RJ45","speed":"1G"},{"pattern":"b","start":1,"count":1,"media":"RJ45","speed":"1G"}]}')
T_ISR=$(tpl '{"name":"Cisco ISR4331","type":"router","vendor":"Cisco","model":"ISR4331","partNumber":"ISR4331/K9","ports":[{"pattern":"GigabitEthernet0/0/{n}","start":0,"count":3,"media":"RJ45","speed":"1G"}]}')
T_CBS=$(tpl '{"name":"Cisco CBS220-24T-4G","type":"l2_switch","vendor":"Cisco","model":"CBS220-24T-4G","partNumber":"CBS220-24T-4G","ports":[{"pattern":"GigabitEthernet{n}","start":1,"count":24,"media":"RJ45","speed":"1G"},{"pattern":"GigabitEthernet{n}","start":25,"count":4,"media":"SFP","speed":"1G"}]}')
T_C13=$(tpl '{"name":"Cisco C1300-24T-4G","type":"l2_switch","vendor":"Cisco","model":"C1300-24T-4G","partNumber":"C1300-24T-4G","ports":[{"pattern":"GigabitEthernet1/0/{n}","start":1,"count":24,"media":"RJ45","speed":"1G"},{"pattern":"GigabitEthernet1/0/{n}","start":25,"count":4,"media":"SFP","speed":"1G"}]}')
CL=$(p POST /orgs/$ORG/clusters "{\"kind\":\"ha_active_passive\",\"name\":\"CJIDC-HA\",\"hostname\":\"VPN_CJIDC\",\"mgmtIp\":\"10.136.4.101/24\",\"siteId\":\"$IDC\"}" | id)
dev() { p POST /orgs/$ORG/devices "$1" | id; }
FW1=$(dev "{\"hostname\":\"VPN_CJIDC\",\"type\":\"firewall\",\"siteId\":\"$IDC\",\"templateId\":\"$T_FG\",\"serialNumber\":\"FGT80FTK22027891\",\"role\":\"edge\",\"clusterId\":\"$CL\",\"clusterRole\":\"primary\",\"clusterMemberNo\":1,\"ownerName\":\"GVN\"}")
FW2=$(dev "{\"hostname\":\"CJIDC_HA_Slaver\",\"type\":\"firewall\",\"siteId\":\"$IDC\",\"templateId\":\"$T_FG\",\"serialNumber\":\"FGT80FTK22027966\",\"role\":\"edge\",\"clusterId\":\"$CL\",\"clusterRole\":\"member\",\"clusterMemberNo\":2,\"ownerName\":\"GVN\"}")
ISR=$(dev "{\"hostname\":\"ISR4331_VN_FV_HanoiOffice_41.1\",\"type\":\"router\",\"siteId\":\"$HN\",\"templateId\":\"$T_ISR\",\"serialNumber\":\"FDO2623M1CH\",\"role\":\"edge\",\"ownerName\":\"GVN\"}")
CBS=$(dev "{\"hostname\":\"CSB220_VN_FV_HanoiOffice_41.2\",\"type\":\"l2_switch\",\"siteId\":\"$HN\",\"templateId\":\"$T_CBS\",\"serialNumber\":\"DNI2551013J\",\"role\":\"access\",\"ownerName\":\"GVN\"}")
S4=$(dev "{\"hostname\":\"c1300-vn-foodville-hcm-162-4\",\"type\":\"l2_switch\",\"siteId\":\"$HCM\",\"templateId\":\"$T_C13\",\"serialNumber\":\"DNI284102TL\",\"role\":\"core\",\"ownerName\":\"GVN\"}")
S5=$(dev "{\"hostname\":\"c1300-vn-foodville-hcm-162-5\",\"type\":\"l2_switch\",\"siteId\":\"$HCM\",\"templateId\":\"$T_C13\",\"serialNumber\":\"DNI284102NG\",\"role\":\"access\",\"ownerName\":\"GVN\"}")
S6=$(dev "{\"hostname\":\"c1300-vn-foodville-hcm-162-6\",\"type\":\"l2_switch\",\"siteId\":\"$HCM\",\"templateId\":\"$T_C13\",\"serialNumber\":\"DNI274501MP\",\"role\":\"access\",\"ownerName\":\"GVN\"}")
S7=$(dev "{\"hostname\":\"c1300-vn-foodville-hcm-162-7\",\"type\":\"l2_switch\",\"siteId\":\"$HCM\",\"templateId\":\"$T_C13\",\"serialNumber\":\"DNI274502EX\",\"role\":\"access\",\"ownerName\":\"GVN\"}")
NET_HN=$(dev "{\"hostname\":\"Internet\",\"type\":\"provider_cloud\",\"siteId\":\"$HN\"}")
NET_HQ=$(dev "{\"hostname\":\"HCMC-HQ\",\"type\":\"provider_cloud\",\"siteId\":\"$HCM\"}")
ifid() { p GET /orgs/$ORG/devices/$1/interfaces | python3 -c "import sys,json;print([i['id'] for i in json.load(sys.stdin)['interfaces'] if i['name']=='$2'][0])"; }
newif() { p POST /orgs/$ORG/devices/$1/interfaces "{\"name\":\"$2\",\"kind\":\"$3\"}" | id; }
mgmt() { # device, interface id, ip
  p POST /orgs/$ORG/devices/$1/ips "{\"interfaceId\":\"$2\",\"address\":\"$3\",\"role\":\"primary\"}" >/dev/null
  V=$(p GET /orgs/$ORG/devices/$1 | python3 -c "import sys,json;d=json.load(sys.stdin);d['mgmtInterfaceId']='$2';print(json.dumps(d))")
  p PATCH /orgs/$ORG/devices/$1 "$V" >/dev/null; }
mgmt $ISR $(ifid $ISR GigabitEthernet0/0/1) 10.136.41.1/24
mgmt $CBS $(newif $CBS Vlan1 svi) 10.136.41.2/24
for pair in "$S4 4" "$S5 5" "$S6 6" "$S7 7"; do set -- ${=pair}; mgmt $1 $(newif $1 Vlan1 svi) 10.136.162.$2/24; done
p POST /orgs/$ORG/devices/$ISR/ips "{\"interfaceId\":\"$(ifid $ISR GigabitEthernet0/0/0)\",\"address\":\"27.72.96.43/30\",\"role\":\"primary\",\"description\":\"WAN\"}" >/dev/null
T1=$(newif $ISR Tunnel1 tunnel); T2=$(newif $ISR Tunnel2 tunnel)
p POST /orgs/$ORG/devices/$ISR/ips "{\"interfaceId\":\"$T1\",\"address\":\"10.136.255.166/30\",\"role\":\"primary\",\"description\":\"VPN-VN_FV_HanoiOffice-Active\"}" >/dev/null
p POST /orgs/$ORG/devices/$ISR/ips "{\"interfaceId\":\"$T2\",\"address\":\"10.136.255.170/30\",\"role\":\"primary\",\"description\":\"VPN-VN_FV_HanoiOffice-Backup\"}" >/dev/null
FT1=$(newif $FW1 VPN-HN-A tunnel); FT2=$(newif $FW1 VPN-HN-B tunnel)
lnk() { p POST /orgs/$ORG/links "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print('link', d.get('kind', d))"; }
ep() { if [ -n "$2" ]; then echo "{\"kind\":\"device\",\"id\":\"$1\",\"interfaceId\":\"$2\"}"; else echo "{\"kind\":\"device\",\"id\":\"$1\"}"; fi; }
lnk "{\"a\":$(ep $FW1 $(ifid $FW1 a)),\"b\":$(ep $FW2 $(ifid $FW2 a)),\"kind\":\"stack\",\"medium\":\"HA heartbeat\"}"
lnk "{\"a\":$(ep $NET_HN),\"b\":$(ep $ISR $(ifid $ISR GigabitEthernet0/0/0)),\"kind\":\"ethernet\",\"service\":\"internet_dedicated\",\"notes\":\"WAN 27.72.96.43\"}"
lnk "{\"a\":$(ep $ISR $(ifid $ISR GigabitEthernet0/0/1)),\"b\":$(ep $CBS $(ifid $CBS GigabitEthernet2)),\"kind\":\"ethernet\",\"medium\":\"Cat6\",\"notes\":\"10.136.41.0/24\"}"
lnk "{\"a\":$(ep $ISR $T1),\"b\":$(ep $FW1 $FT1),\"kind\":\"logical\",\"medium\":\"VPN/IPsec\",\"notes\":\"VPN-VN_FV_HanoiOffice-Active 10.136.255.166/30\"}"
lnk "{\"a\":$(ep $ISR $T2),\"b\":$(ep $FW1 $FT2),\"kind\":\"logical\",\"medium\":\"VPN/IPsec\",\"notes\":\"VPN-VN_FV_HanoiOffice-Backup 10.136.255.170/30\"}"
lnk "{\"a\":$(ep $NET_HQ),\"b\":$(ep $S4),\"kind\":\"ethernet\"}"
for pair in "23 $S7" "22 $S6" "21 $S5"; do set -- ${=pair}; lnk "{\"a\":$(ep $S4 $(ifid $S4 GigabitEthernet1/0/$1)),\"b\":$(ep $2 $(ifid $2 GigabitEthernet1/0/24)),\"kind\":\"ethernet\",\"medium\":\"Cat6\"}"; done
DG=$(p POST /orgs/$ORG/diagrams '{"name":"CJ Foodville — tổng quan","layer":"physical"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['diagram']['id'])")
V=$(python3 -c "
import json
pos={'$NET_HQ':(300,0),'$S4':(300,140),'$S7':(60,320),'$S6':(300,320),'$S5':(540,320),
     '$FW1':(300,560),'$FW2':(300,720),
     '$NET_HN':(900,0),'$ISR':(900,160),'$CBS':(900,420)}
nodes=[{'id':'n%d'%i,'refKind':'device','refId':k,'x':v[0],'y':v[1]} for i,(k,v) in enumerate(pos.items())]
print(json.dumps({'version':1,'view':{'nodes':nodes,'edges':[],'annotations':[]},'changes':[]}))")
p POST /orgs/$ORG/diagrams/$DG/save "$V" | python3 -c "import sys,json;print('diagram saved v', json.load(sys.stdin)['detail']['diagram']['version'])"
echo $DG > /tmp/ui-diagram-id; echo $FW1 > /tmp/ui-fw1
