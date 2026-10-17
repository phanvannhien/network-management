// Writes testdata/import-sample.xlsx (P1-25) in the customer's device sheet layout: a title row with the person in
// charge, then No / Site (the company → category) / Location (the place → site) / Category (the device type) /
// Hostname / Ip Address mgmt / PartNumber / S/N / User name / Password. Data of "Tập đoàn Mẫu" with names written the
// way people type them — no accents, other spellings, spare spaces — to exercise the matching. Serials and
// passwords are made up; the importer never sends the password column to the server.
//   node scripts/make-import-sample.mjs
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'

XLSX.set_fs(fs)
const title = ['', '', '', '', 'Person in charge', 'Nhóm IT Tập đoàn Mẫu']
const header = [
  'No',
  'Site',
  'Location',
  'Category',
  'Hostname',
  'Ip Address mgmt',
  'PartNumber',
  'S/N',
  'User name',
  'Password',
]
const data = [
  [
    'TAP DOAN MAU',
    'IDC Ho Chi Minh',
    'Firewall',
    'FW-IDC-01',
    '10.136.4.101',
    'FortiGate 80F',
    'FGT80FTK2201001',
  ],
  [
    'TAP DOAN MAU',
    'IDC HCM',
    'Firewall',
    'FW-IDC-02',
    '10.136.4.101',
    'FortiGate 80F',
    'FGT80FTK2201002',
  ],
  ['MAU FOOD', 'HaNoi', 'Router', 'R-HN-01', '10.136.41.1', 'ISR4331/K9', 'FDO2231M1AB'],
  ['Mẫu Food ', 'Ha Noi', 'Switch', 'SW-HN-01', '10.136.41.2', 'CBS220-24T-4G', 'DNI2231013A'],
  ['Mau Food', 'Hochiminh', 'Switch', 'SW-HCM-01', '10.136.162.4', 'C1300-24T-4G', 'DNI2231013B'],
  ['mau food', 'HCM', 'Switch', 'SW-HCM-02', '10.136.162.5', 'C1300-24T-4G', 'DNI2231013C'],
  ['Mẫu Food', 'Ho Chi Minh', 'Switch', 'SW-HCM-03', '10.136.162.6', 'C1300-24T-4G', 'DNI2231013D'],
  ['Mẫu Food', 'TP HCM', 'Switch', 'SW-HCM-04', '10.136.162.7', 'C1300-24T-4G', 'DNI2231013E'],
  ['MAU AGRI', 'HungYen', 'Router', 'R-HY-01', '10.136.61.1', 'ISR4331/K9', 'FTX2231A001'],
  ['Mau Agri', 'Vinh Long', 'Router', 'R-VL-01', '10.136.62.1', 'ISR4321/K9', 'FTX2231A002'],
  [
    'Mẫu Agri',
    'Binh Dinh Factory',
    'Router',
    'R-BD-01',
    '10.136.63.1',
    'CISCO2921/K9',
    'FTX2231A003',
  ],
  ['Mẫu Agri', 'BenCat', 'Router', 'R-BC-01', '10.136.64.1', 'CISCO2911/K9', 'FTX2231A004'],
  ['Mẫu Agri', 'Bien Hoa', 'Router', 'R-BH-01', '10.136.65.1', 'CISCO2951/K9', 'FTX2231A005'],
  ['Mẫu Agri', 'Ho Chi Minh', 'Router', 'R-HCM-01', '10.136.66.1', 'ISR4331/K9', 'FTX2231A006'],
  // New to the inventory: an access point, and a NAS whose model the catalog does not know.
  [
    'Mau Food',
    'Hochiminh',
    'Access Point',
    'AP-HCM-01',
    '10.136.162.21',
    'C9120AXI-S',
    'FJC2231Z001',
  ],
  ['Mau Food', 'Hanoi', 'NAS', 'NAS-HN-01', '10.136.41.10', 'DS920+', ''],
]
const rows = data.map((r, i) => [i + 1, ...r, 'admin', `fake-${i + 1}`])
const sheet = XLSX.utils.aoa_to_sheet([title, header, ...rows])
sheet['!cols'] = header.map((h) => ({ wch: Math.max(h.length, 16) }))
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, sheet, 'Devices')
const out = path.resolve(import.meta.dirname, '../../testdata/import-sample.xlsx')
XLSX.writeFile(book, out)
console.log('wrote', out, rows.length, 'rows')
