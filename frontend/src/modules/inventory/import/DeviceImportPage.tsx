import { useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Network, ShieldAlert, Upload } from 'lucide-react'
import { useMemo, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { FormField } from '@/components/FormField'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDiagramMutations } from '@/editor/doc/api'
import { useCategories, useSaveSite, useSites } from '@/modules/sites/sites'
import {
  DEVICE_TYPES,
  useCatalog,
  useTemplates,
  type CatalogModel,
  type DeviceType,
} from '../devices'
import { postImport, type ImportRowResult } from './api'
import { importedView } from './layout'
import { norm, readWorkbook, type Sheet } from './parse'
import {
  autoMap,
  buildPlan,
  dataRows,
  detectHeader,
  FIELDS,
  fileProblems,
  isSecretHeader,
  matchCatalog,
  matchCategory,
  matchSite,
  proposeClusters,
  siteKeyOf,
  suggestSiteCode,
  toImportCluster,
  toImportRow,
  typeFromText,
  type Field,
  type PlannedRow,
} from './plan'
import { useHelpTopic } from '@/help/topic'

// Excel import of devices (P1-21, SRS §12). Steps on one page: file → columns → values (company → category,
// place → site, kind → type) → preview (server dry run, HA pairs) → import in chunks with progress → optional first
// diagram. The file is read in the browser; credential columns are never mapped nor sent.

type MatchBy = 'hostname' | 'serial' | 'none'
type SiteChoice = { siteId: string } | { create: { code: string; name: string } }

const CHUNK = 200
const TEMPLATE_HEADERS = [
  'Site',
  'Location',
  'Category',
  'Hostname',
  'Ip Address mgmt',
  'PartNumber',
  'Model',
  'Vendor',
  'S/N',
  'Notes',
]

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [
      'CÔNG TY A',
      'Văn phòng Hà Nội',
      'Switch',
      'SW-HN-01',
      '10.10.1.2',
      'C1300-24T-4G',
      '',
      'Cisco',
      'DNI000001',
      '',
    ],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Devices')
  XLSX.writeFile(wb, 'ntb-thiet-bi-mau.xlsx')
}

export function DeviceImportPage() {
  const { t } = useTranslation()
  useHelpTopic('thiet-bi#nhap-tu-excel')
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sites = useSites(orgId)
  const categories = useCategories(orgId)
  const templates = useTemplates(orgId)
  const catalog = useCatalog(orgId)
  const [skipCatalog, setSkipCatalog] = useState<Set<string>>(new Set())
  const saveSite = useSaveSite(orgId)
  const diagrams = useDiagramMutations(orgId)

  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [mapping, setMapping] = useState<Field[]>([])
  const [companyMap, setCompanyMap] = useState<Record<string, string>>({})
  const [siteMap, setSiteMap] = useState<Record<string, SiteChoice>>({})
  const [typeMap, setTypeMap] = useState<Record<string, DeviceType>>({})
  const [matchBy, setMatchBy] = useState<MatchBy>('hostname')
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Map<number, ImportRowResult>>(new Map())
  const [busy, setBusy] = useState<null | { done: number; total: number }>(null)
  const [done, setDone] = useState<ImportRowResult[] | null>(null)

  const sheet = sheets[sheetIdx]
  const header = useMemo(() => (sheet ? detectHeader(sheet.rows) : null), [sheet])
  const rows = useMemo(() => (sheet && header ? dataRows(sheet.rows, header) : []), [sheet, header])
  const secretCols = header ? header.headers.filter(isSecretHeader) : []
  const col = (f: Field) => mapping.indexOf(f)
  const cell = (cells: string[], f: Field) =>
    col(f) >= 0 ? (cells[col(f)] ?? '') : (header?.meta[f] ?? '')

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const parsed = readWorkbook(await f.arrayBuffer())
      // The sheet with a recognisable table first.
      const best = Math.max(
        0,
        parsed.findIndex((s) => detectHeader(s.rows) !== null),
      )
      setFileName(f.name)
      setSheets(parsed)
      pickSheet(parsed, best)
    } catch {
      toast.error(t('deviceImport.unreadable'))
    }
  }
  const pickSheet = (all: Sheet[], i: number) => {
    setSheetIdx(i)
    const h = all[i] ? detectHeader(all[i].rows) : null
    setMapping(h ? autoMap(h.headers) : [])
    setCompanyMap({})
    setSiteMap({})
    setTypeMap({})
    setPreview(new Map())
    setDone(null)
  }

  // Distinct values to confirm, with what the matcher proposes.
  const companies = useMemo(
    () => [...new Set(rows.map((r) => cell(r.cells, 'category')))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mapping, header],
  )
  const categoryOf = (company: string): string => {
    const chosen = companyMap[norm(company)]
    if (chosen !== undefined) return chosen
    return matchCategory(company, categories.data ?? [])?.id ?? ''
  }
  const places = useMemo(() => {
    const out = new Map<string, { company: string; location: string; count: number }>()
    for (const r of rows) {
      const company = cell(r.cells, 'category')
      const location = cell(r.cells, 'site')
      const k = siteKeyOf(company, location)
      const p = out.get(k)
      out.set(k, { company, location, count: (p?.count ?? 0) + 1 })
    }
    return [...out.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping, header])
  const siteLikes = useMemo(
    () =>
      (sites.data ?? []).map((s) => ({
        id: s.id,
        code: s.code,
        localCode: s.localCode,
        name: s.name,
        categoryId: s.categoryId ?? null,
      })),
    [sites.data],
  )
  const autoSite = (company: string, location: string) =>
    matchSite(location, categoryOf(company) || null, siteLikes)
  const siteChoice = (key: string, company: string, location: string): SiteChoice | null => {
    if (siteMap[key]) return siteMap[key]!
    const m = autoSite(company, location)
    return m.siteId ? { siteId: m.siteId } : null
  }
  const kinds = useMemo(
    () => [...new Set(rows.map((r) => cell(r.cells, 'type')))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mapping, header],
  )
  const typeOf = (kind: string): DeviceType | null => typeMap[norm(kind)] ?? typeFromText(kind)

  // The plan: new sites get a placeholder id until they are created at import time.
  const siteIds: Record<string, string> = {}
  for (const [k, p] of places) {
    const c = siteChoice(k, p.company, p.location)
    if (c) siteIds[k] = 'siteId' in c ? c.siteId : `new:${k}`
  }
  const types: Record<string, DeviceType> = {}
  for (const k of kinds) {
    const ty = typeOf(k)
    if (ty) types[norm(k)] = ty
  }
  const basePlan: PlannedRow[] = useMemo(
    () =>
      header
        ? buildPlan(rows, mapping, header.meta, { types, sites: siteIds }, templates.data ?? [])
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mapping, header, JSON.stringify(types), JSON.stringify(siteIds), templates.data],
  )
  // Models the organization has no template for but the system templates know (ADR-035): the device is created from
  // the system template directly (nothing copied), and its type refines a generic "Switch".
  const catalogOf = useMemo(() => {
    const out = new Map<number, CatalogModel>()
    for (const p of basePlan)
      if (!p.templateId) {
        const c = matchCatalog(catalog.data ?? [], [p.raw.partNumber ?? '', p.model], p.type)
        if (c) out.set(p.line, c)
      }
    return out
  }, [basePlan, catalog.data])
  const plan: PlannedRow[] = useMemo(
    () =>
      basePlan.map((p) => {
        const c = catalogOf.get(p.line)
        if (!c || skipCatalog.has(c.id)) return p
        const switches = new Set(['l2_switch', 'l3_switch', 'poe_switch'])
        const type = p.type && switches.has(p.type) && switches.has(c.type) ? c.type : p.type
        return { ...p, type, vendor: p.vendor || c.vendor, catalogId: c.id }
      }),
    [basePlan, catalogOf, skipCatalog],
  )
  const fromCatalog = [...new Map([...catalogOf.values()].map((c) => [c.id, c])).values()]
  const clusters = useMemo(
    () => proposeClusters(plan).map((c) => ({ ...c, accepted: !rejected.has(c.lines.join(',')) })),
    [plan, rejected],
  )
  const inFile = useMemo(() => fileProblems(plan, clusters), [plan, clusters])
  const clusterOf = (line: number) => clusters.find((c) => c.accepted && c.lines.includes(line))
  const noTemplate = [...new Set(plan.filter((p) => !p.templateId && p.model).map((p) => p.model))]
  const ready = plan.filter((p) => p.problems.length === 0 && !inFile.has(p.line))

  const requestBody = (rowsIn: PlannedRow[], dryRun: boolean, ids: Record<string, string>) => {
    const fix = (id: string | null) => (id && id.startsWith('new:') ? (ids[id] ?? null) : id)
    const fixed = rowsIn.map((r) => ({
      ...r,
      siteId: fix(r.siteId),
    }))
    const used = clusters.filter((c) => c.accepted && fixed.some((r) => c.lines.includes(r.line)))
    return {
      dryRun,
      matchBy,
      clusters: used.map((c) =>
        toImportCluster({ ...c, siteId: fix(c.siteId) ?? c.siteId }, fixed),
      ),
      rows: fixed.map((r) => toImportRow(r, clusterOf(r.line))),
    }
  }

  const check = async () => {
    // Rows of sites still to be created are checked when they are imported.
    const existing = ready.filter((r) => !r.siteId?.startsWith('new:'))
    if (existing.length === 0) return
    setBusy({ done: 0, total: existing.length })
    try {
      const out = new Map<number, ImportRowResult>()
      for (let i = 0; i < existing.length; i += CHUNK) {
        for (const r of await postImport(
          orgId,
          requestBody(existing.slice(i, i + CHUNK), true, {}),
        ))
          out.set(r.row, r)
        setBusy({ done: Math.min(i + CHUNK, existing.length), total: existing.length })
      }
      setPreview(out)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deviceImport.failed'))
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    setBusy({ done: 0, total: ready.length })
    try {
      // New sites first (each one confirmed in the values step).
      const ids: Record<string, string> = {}
      for (const [k, p] of places) {
        const c = siteMap[k]
        if (!c || !('create' in c) || !ready.some((r) => r.siteId === `new:${k}`)) continue
        const created = await saveSite.mutateAsync({
          body: {
            code: c.create.code,
            name: c.create.name,
            categoryId: categoryOf(p.company) || null,
          },
        })
        if (created) ids[`new:${k}`] = created.id
      }
      const results: ImportRowResult[] = []
      for (let i = 0; i < ready.length; i += CHUNK) {
        results.push(
          ...(await postImport(orgId, requestBody(ready.slice(i, i + CHUNK), false, ids))),
        )
        setBusy({ done: Math.min(i + CHUNK, ready.length), total: ready.length })
      }
      setDone(results)
      void qc.invalidateQueries({ queryKey: ['orgs', orgId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deviceImport.failed'))
    } finally {
      setBusy(null)
    }
  }

  const draw = async () => {
    if (!done) return
    const ok = done.filter((r) => r.deviceId)
    const byLine = new Map(plan.map((p) => [p.line, p]))
    const siteOfResult = new Map<string, string>()
    const devices = ok.map((r) => {
      const p = byLine.get(r.row)
      const c = clusterOf(r.row)
      return { id: r.deviceId!, siteId: p?.siteId ?? '', group: c ? `0${c.key}` : `1${r.hostname}` }
    })
    // Placeholder site ids of created sites: look the real one up in the refreshed list by device.
    const fresh = await sites.refetch()
    for (const d of devices)
      if (d.siteId.startsWith('new:')) {
        const [, key] = d.siteId.split('new:')
        const choice = siteMap[key!]
        const s =
          choice && 'create' in choice
            ? fresh.data?.find((x) => x.name === choice.create.name)
            : undefined
        siteOfResult.set(d.id, s?.id ?? '')
      }
    const placed = devices
      .map((d) => ({ ...d, siteId: siteOfResult.get(d.id) ?? d.siteId }))
      .filter((d) => d.siteId)
    const order = [...new Set(placed.map((d) => d.siteId))]
    try {
      const created = await diagrams.create.mutateAsync({
        name: t('deviceImport.diagramName', { file: fileName }).slice(0, 120),
        layer: 'physical',
      })
      if (!created) return
      await diagrams.save.mutateAsync({
        diagramId: created.diagram.id,
        body: { version: created.diagram.version, view: importedView(placed, order), changes: [] },
      })
      void navigate(`/o/${orgId}/diagrams/${created.diagram.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.save'))
    }
  }

  const resultOf = (line: number) => (done ?? []).find((r) => r.row === line) ?? preview.get(line)
  const counts = done && {
    created: done.filter((r) => r.action === 'create').length,
    updated: done.filter((r) => r.action === 'update').length,
    failed: done.filter((r) => r.action === 'error').length,
  }
  const takenCodes = new Set((sites.data ?? []).map((s) => s.localCode))

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title={t('deviceImport.title')}
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download aria-hidden /> {t('deviceImport.template')}
          </Button>
        }
      />
      <p className="max-w-3xl text-muted-foreground">{t('deviceImport.intro')}</p>

      {/* 1. File */}
      <section aria-labelledby="imp-file" className="space-y-2">
        <h2 id="imp-file" className="font-semibold">
          1. {t('deviceImport.stepFile')}
        </h2>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border-control px-4 py-3 hover:bg-accent">
          <Upload aria-hidden className="size-4" />
          <span>{fileName || t('deviceImport.pick')}</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            aria-label={t('deviceImport.pick')}
            onChange={(e) => void onFile(e)}
          />
        </label>
        {sheets.length > 1 && (
          <FormField label={t('deviceImport.sheet')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={sheetIdx}
                onChange={(e) => pickSheet(sheets, Number(e.target.value))}
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        {sheet && !header && (
          <Alert variant="destructive">
            <AlertDescription>{t('deviceImport.noHeader')}</AlertDescription>
          </Alert>
        )}
        {secretCols.length > 0 && (
          <Alert>
            <ShieldAlert aria-hidden />
            <AlertTitle>
              {t('deviceImport.secretsTitle', { cols: secretCols.join(', ') })}
            </AlertTitle>
            <AlertDescription>{t('deviceImport.secretsBody')}</AlertDescription>
          </Alert>
        )}
      </section>

      {header && (
        <>
          {/* 2. Columns */}
          <section aria-labelledby="imp-cols" className="space-y-2">
            <h2 id="imp-cols" className="font-semibold">
              2. {t('deviceImport.stepColumns', { count: rows.length })}
            </h2>
            <p className="text-sm text-muted-foreground">{t('deviceImport.columnsGuide')}</p>
            <div className="grid max-w-4xl grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)] gap-x-4 gap-y-1.5">
              {header.headers.map((h, i) =>
                h || mapping[i] !== 'ignore' ? (
                  <ColumnRow
                    key={i}
                    header={h || `#${i + 1}`}
                    sample={rows[0]?.cells[i] ?? ''}
                    value={mapping[i] ?? 'ignore'}
                    secret={isSecretHeader(h)}
                    onChange={(f) =>
                      setMapping((m) =>
                        m.map((x, j) => (j === i ? f : x === f && f !== 'ignore' ? 'ignore' : x)),
                      )
                    }
                  />
                ) : null,
              )}
            </div>
            {Object.keys(header.meta).length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('deviceImport.meta', {
                  values: Object.entries(header.meta)
                    .map(([f, v]) => `${t(`deviceImport.fields.${f as 'owner'}`)}: ${v}`)
                    .join(', '),
                })}
              </p>
            )}
          </section>

          {/* 3. Values */}
          <section aria-labelledby="imp-values" className="space-y-3">
            <h2 id="imp-values" className="font-semibold">
              3. {t('deviceImport.stepValues')}
            </h2>
            {col('category') >= 0 || header.meta.category ? (
              <div className="space-y-1.5">
                <h3 className="text-sm font-medium">{t('deviceImport.companies')}</h3>
                <p className="text-sm text-muted-foreground">{t('deviceImport.companiesGuide')}</p>
                {companies.map((c) => (
                  <div
                    key={c}
                    className="grid max-w-3xl grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)] items-center gap-4"
                  >
                    <span className="truncate">{c || t('deviceImport.empty')}</span>
                    <NativeSelect
                      aria-label={t('deviceImport.categoryFor', { value: c })}
                      value={categoryOf(c)}
                      onChange={(e) => setCompanyMap((m) => ({ ...m, [norm(c)]: e.target.value }))}
                    >
                      <option value="">{t('deviceImport.orgLevel')}</option>
                      {(categories.data ?? []).map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.path}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium">{t('deviceImport.places')}</h3>
              <p className="text-sm text-muted-foreground">{t('deviceImport.placesGuide')}</p>
              {places.map(([k, p]) => {
                const m = autoSite(p.company, p.location)
                const choice = siteChoice(k, p.company, p.location)
                const value = !choice ? '' : 'siteId' in choice ? choice.siteId : '__new'
                const ordered = [...(sites.data ?? [])].sort(
                  (a, b) =>
                    Number(!m.candidates.includes(a.id)) - Number(!m.candidates.includes(b.id)),
                )
                return (
                  <div
                    key={k}
                    className="grid max-w-4xl grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.4fr)] items-start gap-4"
                  >
                    <span className="pt-1.5">
                      {p.location || t('deviceImport.empty')}{' '}
                      <span className="text-xs text-muted-foreground">
                        {p.company && `· ${p.company} `}·{' '}
                        {t('deviceImport.rowsCount', { count: p.count })}
                      </span>
                      {!siteMap[k] && m.kind === 'proposal' && (
                        <span className="ml-1 rounded-sm bg-status-warning/10 px-1 text-xs text-status-warning">
                          {t('deviceImport.proposal')}
                        </span>
                      )}
                    </span>
                    <div className="space-y-1">
                      <NativeSelect
                        aria-label={t('deviceImport.siteFor', { value: p.location })}
                        value={value}
                        onChange={(e) =>
                          setSiteMap((s) => ({
                            ...s,
                            [k]:
                              e.target.value === '__new'
                                ? {
                                    create: {
                                      code: suggestSiteCode(p.location, takenCodes),
                                      name: p.location,
                                    },
                                  }
                                : { siteId: e.target.value },
                          }))
                        }
                      >
                        <option value="" disabled>
                          {t('deviceImport.pickSite')}
                        </option>
                        {ordered.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} · {s.name}
                          </option>
                        ))}
                        <option value="__new">{t('deviceImport.newSite')}</option>
                      </NativeSelect>
                      {choice && 'create' in choice && (
                        <div className="flex gap-2">
                          <Input
                            aria-label={t('deviceImport.newSiteCode')}
                            className="w-28 font-mono uppercase"
                            value={choice.create.code}
                            onChange={(e) =>
                              setSiteMap((s) => ({
                                ...s,
                                [k]: {
                                  create: { ...choice.create, code: e.target.value.toUpperCase() },
                                },
                              }))
                            }
                          />
                          <Input
                            aria-label={t('deviceImport.newSiteName')}
                            value={choice.create.name}
                            onChange={(e) =>
                              setSiteMap((s) => ({
                                ...s,
                                [k]: { create: { ...choice.create, name: e.target.value } },
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium">{t('deviceImport.kinds')}</h3>
              {kinds.map((k) => (
                <div
                  key={k}
                  className="grid max-w-3xl grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)] items-center gap-4"
                >
                  <span>{k || t('deviceImport.empty')}</span>
                  <NativeSelect
                    aria-label={t('deviceImport.typeFor', { value: k })}
                    value={typeOf(k) ?? ''}
                    onChange={(e) =>
                      setTypeMap((m) => ({ ...m, [norm(k)]: e.target.value as DeviceType }))
                    }
                  >
                    <option value="" disabled>
                      {t('deviceImport.pickType')}
                    </option>
                    {DEVICE_TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {t(`devices.types.${ty}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Preview */}
          <section aria-labelledby="imp-preview" className="space-y-3">
            <h2 id="imp-preview" className="font-semibold">
              4. {t('deviceImport.stepPreview')}
            </h2>
            <FormField
              label={t('deviceImport.matchBy')}
              guide={t('deviceImport.matchByGuide')}
              className="max-w-md"
            >
              {(p) => (
                <NativeSelect
                  {...p}
                  value={matchBy}
                  onChange={(e) => setMatchBy(e.target.value as MatchBy)}
                >
                  <option value="hostname">{t('deviceImport.match.hostname')}</option>
                  <option value="serial">{t('deviceImport.match.serial')}</option>
                  <option value="none">{t('deviceImport.match.none')}</option>
                </NativeSelect>
              )}
            </FormField>
            {fromCatalog.length > 0 && (
              <div className="max-w-3xl space-y-1 rounded-md border border-border p-3">
                <h3 className="text-sm font-medium">{t('deviceImport.catalogTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('deviceImport.catalogGuide')}</p>
                {fromCatalog.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!skipCatalog.has(c.id)}
                      onChange={(e) =>
                        setSkipCatalog((sk) => {
                          const next = new Set(sk)
                          if (e.target.checked) next.delete(c.id)
                          else next.add(c.id)
                          return next
                        })
                      }
                    />
                    <span>
                      {c.vendor} {c.model} · {t('addPorts.portCount', { count: c.portCount })}
                      {!c.verified && (
                        <span className="ml-1 text-xs text-status-warning">
                          {t('deviceImport.catalogUnverified')}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {noTemplate.length > 0 && (
              <Alert className="max-w-3xl">
                <AlertTitle>
                  {t('deviceImport.noTemplateTitle', { models: noTemplate.join(', ') })}
                </AlertTitle>
                <AlertDescription>
                  {t('deviceImport.noTemplateBody')}{' '}
                  <Link className="underline" to={`/o/${orgId}/device-templates`} target="_blank">
                    {t('deviceImport.openTemplates')}
                  </Link>
                </AlertDescription>
              </Alert>
            )}
            {clusters.length > 0 && (
              <div className="max-w-3xl space-y-1 rounded-md border border-border p-3">
                <h3 className="text-sm font-medium">{t('deviceImport.clusters')}</h3>
                <p className="text-sm text-muted-foreground">{t('deviceImport.clustersGuide')}</p>
                {clusters.map((c) => {
                  const id = c.lines.join(',')
                  const members = c.lines
                    .map((l) => plan.find((p) => p.line === l)?.hostname)
                    .join(' + ')
                  return (
                    <label key={id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={c.accepted}
                        onChange={(e) =>
                          setRejected((r) => {
                            const next = new Set(r)
                            if (e.target.checked) next.delete(id)
                            else next.add(id)
                            return next
                          })
                        }
                      />
                      <span>
                        {t(c.kind === 'stack' ? 'deviceImport.stack' : 'deviceImport.ha', {
                          members,
                          ip: c.ip,
                        })}
                        <span className="block text-xs text-muted-foreground">
                          {t('deviceImport.primaryGuess', {
                            host: plan.find((p) => p.line === c.lines[0])?.hostname ?? '',
                          })}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1.5">{t('deviceImport.line')}</th>
                    <th className="px-2 py-1.5">Hostname</th>
                    <th className="px-2 py-1.5">{t('deviceImport.fields.type')}</th>
                    <th className="px-2 py-1.5">Site</th>
                    <th className="px-2 py-1.5">IP</th>
                    <th className="px-2 py-1.5">Model</th>
                    <th className="px-2 py-1.5">{t('deviceImport.result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((p) => {
                    const res = resultOf(p.line)
                    const local = [...p.problems, ...(inFile.get(p.line) ?? [])]
                    const site = p.siteId?.startsWith('new:')
                      ? t('deviceImport.siteToCreate')
                      : sites.data?.find((s) => s.id === p.siteId)?.code
                    const c = clusterOf(p.line)
                    return (
                      <tr key={p.line} className="border-t border-border align-top">
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{p.line}</td>
                        <td className="px-2 py-1.5 font-mono text-xs">{p.hostname}</td>
                        <td className="px-2 py-1.5">
                          {p.type ? t(`devices.types.${p.type}`) : '—'}
                        </td>
                        <td className="px-2 py-1.5">{site ?? '—'}</td>
                        <td className="px-2 py-1.5 font-mono text-xs">
                          {p.mgmtIp}
                          {c && (
                            <span className="block font-sans text-muted-foreground">
                              {t('deviceImport.vip')}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {p.model}
                          {p.catalogId ? (
                            <span className="block text-xs text-muted-foreground">
                              {t('deviceImport.withCatalog')}
                            </span>
                          ) : p.templateId ? (
                            <span className="block text-xs text-muted-foreground">
                              {t('deviceImport.withTemplate')}
                            </span>
                          ) : (
                            <span className="block text-xs text-status-warning">
                              {t('deviceImport.noTemplate')}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <RowStatus local={local} result={res} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 5. Import */}
          <section aria-labelledby="imp-run" className="space-y-2">
            <h2 id="imp-run" className="font-semibold">
              5. {t('deviceImport.stepRun')}
            </h2>
            {busy && (
              <div role="status" className="max-w-md space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((busy.done / Math.max(1, busy.total)) * 100)}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">{t('deviceImport.progress', busy)}</p>
              </div>
            )}
            {!done && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy !== null || ready.length === 0}
                  onClick={() => void check()}
                >
                  {t('deviceImport.check')}
                </Button>
                <Button disabled={busy !== null || ready.length === 0} onClick={() => void run()}>
                  <FileSpreadsheet aria-hidden /> {t('deviceImport.run', { count: ready.length })}
                </Button>
                {ready.length < plan.length && (
                  <span className="self-center text-sm text-muted-foreground">
                    {t('deviceImport.skipped', { count: plan.length - ready.length })}
                  </span>
                )}
              </div>
            )}
            {done && counts && (
              <div className="space-y-2">
                <p role="status">{t('deviceImport.done', counts)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void draw()}
                    disabled={counts.created + counts.updated === 0}
                  >
                    <Network aria-hidden /> {t('deviceImport.draw')}
                  </Button>
                  <Link
                    className={buttonVariants({ variant: 'outline' })}
                    to={`/o/${orgId}/devices`}
                  >
                    {t('deviceImport.toList')}
                  </Link>
                </div>
                <p className="text-sm text-muted-foreground">{t('deviceImport.drawGuide')}</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function ColumnRow({
  header,
  sample,
  value,
  secret,
  onChange,
}: {
  header: string
  sample: string
  value: Field
  secret: boolean
  onChange: (f: Field) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <span className="truncate pt-1.5">
        {header}
        {sample && !secret && (
          <span className="ml-2 text-xs text-muted-foreground">vd {sample}</span>
        )}
      </span>
      {secret ? (
        <span className="pt-1.5 text-sm text-status-warning">
          {t('deviceImport.secretSkipped')}
        </span>
      ) : (
        <NativeSelect
          aria-label={t('deviceImport.columnFor', { header })}
          value={value}
          onChange={(e) => onChange(e.target.value as Field)}
        >
          <option value="ignore">{t('deviceImport.ignore')}</option>
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {t(`deviceImport.fields.${f}`)}
            </option>
          ))}
        </NativeSelect>
      )}
    </>
  )
}

function RowStatus({ local, result }: { local: string[]; result?: ImportRowResult }) {
  const { t } = useTranslation()
  if (local.length > 0) return <span className="text-status-down">{local.join('; ')}</span>
  if (!result) return <span className="text-muted-foreground">{t('deviceImport.notChecked')}</span>
  return (
    <span className={cn(result.action === 'error' ? 'text-status-down' : 'text-status-up')}>
      {result.action === 'error' ? result.message : t(`deviceImport.action.${result.action}`)}
      {result.warnings.map((w) => (
        <span key={w} className="block text-xs text-status-warning">
          {w}
        </span>
      ))}
    </span>
  )
}
