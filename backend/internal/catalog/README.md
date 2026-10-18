# Built-in device catalog (ADR-035)

Read-only reference data shipped with the software: common network products with their real port layout, so an
organization gets correct ports without typing a template. Entries are system templates used directly (a device keeps
`catalog_id`); "copy to edit" makes an organization template from one.

One JSON file per vendor group in `data/` (embedded into the binary). Format:

```json
{
  "models": [
    {
      "id": "cisco-c1300-24t-4g",
      "vendor": "Cisco",
      "family": "Catalyst 1300",
      "model": "C1300-24T-4G",
      "partNumbers": ["C1300-24T-4G"],
      "aliases": ["Catalyst 1300-24T-4G"],
      "type": "l2_switch",
      "uHeight": 1,
      "ports": [
        { "pattern": "GigabitEthernet{m}/0/{n}", "start": 1, "count": 24, "media": "RJ45", "speed": "1G" },
        { "pattern": "GigabitEthernet{m}/0/{n}", "start": 25, "count": 4, "media": "SFP", "speed": "1G" },
        { "pattern": "console", "start": 1, "count": 1, "media": "Console" }
      ],
      "verified": true,
      "source": "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-1300-series-switches/nb-06-cat1300-ser-data-sheet-cte-en.html",
      "notes": ""
    }
  ]
}
```

Rules
- `id`: unique, lowercase `vendor-model` with `-` only.
- `type`: one of the API `DeviceType` values (router, l3_switch, l2_switch, poe_switch, firewall, load_balancer,
  wireless_controller, access_point, vpn_gateway, sdwan_edge, modem, ont, olt, wireless_bridge, console_server, …).
  A switch whose access ports give PoE is `poe_switch`; a switch that routes (Catalyst 9300, CX 6200…) is `l3_switch`.
- `model`: the name engineers write (as in a customer spreadsheet); `partNumbers`: orderable SKUs incl. regional
  suffixes (`-E`, `-EU`, `/K9`), case as the vendor writes them; `aliases`: other spellings people use.
- `ports`: port groups as the CLI names them — `{n}` = port number from `start`, `{m}` = stack member number (use it
  only for stackable models whose CLI puts the member in the name, e.g. Cisco `GigabitEthernet1/0/1`).
  - `media`: `RJ45`, `SFP`, `SFP+`, `SFP28`, `QSFP`, `PON`, `xDSL`, `Serial`, `Console`, `Cellular`.
    Combo ports: list them once, as RJ45 (note it in `notes`).
  - `speed`: `100M`, `1G`, `2.5G`, `5G`, `10G`, `25G`, `40G`, `100G` (max speed of the port).
  - `poe: true` on the PoE ports only.
  - Include a dedicated out-of-band management port (e.g. FortiGate `mgmt`, Catalyst 9300 `GigabitEthernet0/0`) and the
    console port (`console`, media Console). Do not include USB, fan or power sockets, or optional network modules.
  - Port names must be unique within a model; at most 1000 ports; pattern ≤ 60 characters.
- `verified`: true only when port counts / naming were checked against the vendor datasheet or admin guide at
  `source`; otherwise false (the UI shows "cần kiểm tra").
- `source`: the vendor datasheet, or the NetBox device type library page the entry was checked against (ADR-041).

Photos (P2-12, ADR-041)
- `images/<id>.front.jpg` / `images/<id>.rear.jpg`: orthogonal front / rear views from the NetBox community device type
  library (CC0), converted once to JPEG, at most 1200 px wide (never upscaled). No vendor marketing pictures.
- `images/SOURCES.json` maps every file to `{ "source": <NetBox page> }`; when NetBox has no photo of the model but has
  one of a sibling on the same chassis (other uplinks / PoE), that photo may be used with `"similarTo": "<model>"` —
  the UI then says it is a similar model. Never for a different chassis or port count. The loader refuses a photo without a model or a
  source, and a source without a file.
