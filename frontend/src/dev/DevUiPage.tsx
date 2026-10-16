import type { PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import { CircleX, Inbox, Server, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type DataColumn } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { EnvBadge } from '@/components/EnvBadge'
import { FilterBar } from '@/components/FilterBar'
import { emptyFilter, type FilterState } from '@/components/filters'
import { FormField } from '@/components/FormField'
import { KeyValueList } from '@/components/KeyValueList'
import { MfaCodeInput } from '@/components/MfaCodeInput'
import { OrgAvatar, SystemAvatar } from '@/components/OrgAvatar'
import { PageHeader } from '@/components/PageHeader'
import { PasswordInput } from '@/components/PasswordInput'
import { SecretField } from '@/components/SecretField'
import { ExpiryNotice } from '@/components/SessionExpiryWarning'
import { StatCard } from '@/components/StatCard'
import { StatusBadge, type Status } from '@/components/StatusBadge'
import { TechText } from '@/components/TechText'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ORG_COLORS } from '@/lib/orgAvatar'
import { usePreferences } from '@/lib/preferences'
import { SAMPLE_DEVICES, TYPE_LABELS, type SampleDevice } from './sampleDevices'

const STATUSES: Status[] = ['up', 'down', 'warning', 'unknown', 'planned', 'notMonitored']
const FAKE_ORGS = [
  { id: 'org-1', name: 'Văn phòng mẫu' },
  { id: 'org-2', name: 'Công ty Khách hàng A' },
  { id: 'org-3', name: 'Bệnh viện Đa khoa' },
  { id: 'org-4', name: 'Trường THPT Lê Lợi' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-labelledby={`s-${title}`}
    >
      <h2 id={`s-${title}`} className="text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-28 shrink-0 text-label text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

const DEVICE_COLUMNS: DataColumn<SampleDevice>[] = [
  {
    id: 'hostname',
    accessorKey: 'hostname',
    header: 'Hostname',
    meta: { label: 'Hostname', width: 160, pin: true, alwaysVisible: true },
    cell: ({ row }) => (
      <a href="#datatable" className="font-medium hover:text-primary hover:underline">
        {row.original.hostname}
      </a>
    ),
  },
  {
    id: 'mgmtIp',
    accessorKey: 'mgmtIp',
    header: 'IP quản trị',
    meta: { label: 'IP quản trị', width: 140 },
    cell: ({ row }) => <TechText value={row.original.mgmtIp} label="IP quản trị" />,
  },
  {
    id: 'type',
    accessorKey: 'type',
    header: 'Loại',
    meta: { label: 'Loại', width: 120 },
    cell: ({ row }) => TYPE_LABELS[row.original.type],
  },
  { id: 'model', accessorKey: 'model', header: 'Model', meta: { label: 'Model', width: 160 } },
  {
    id: 'serial',
    accessorKey: 'serial',
    header: 'S/N',
    enableSorting: false,
    meta: { label: 'S/N', width: 150 },
    cell: ({ row }) => <TechText value={row.original.serial} label="S/N" />,
  },
  { id: 'site', accessorKey: 'site', header: 'Site', meta: { label: 'Site', width: 140 } },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Trạng thái',
    meta: { label: 'Trạng thái', width: 130 },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
]

function TableDemo({ state }: { state: 'data' | 'loading' | 'empty' | 'error' }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<SortingState>([{ id: 'hostname', desc: false }])
  const [selection, setSelection] = useState<RowSelectionState>(
    state === 'data' ? { [SAMPLE_DEVICES[1].id]: true, [SAMPLE_DEVICES[2].id]: true } : {},
  )
  const rows = SAMPLE_DEVICES.slice(0, 6)
  return (
    <DataTable
      tableId={`dev-${state}`}
      userId="dev"
      caption={`DataTable — ${state}`}
      columns={DEVICE_COLUMNS}
      data={state === 'data' ? rows : []}
      total={state === 'data' ? SAMPLE_DEVICES.length : 0}
      isLoading={state === 'loading'}
      error={state === 'error' ? new Error('HTTP 503') : null}
      getRowId={(d) => d.id}
      rowLabel={(d) => d.hostname}
      pagination={pagination}
      onPaginationChange={setPagination}
      sorting={sorting}
      onSortingChange={setSorting}
      selection={selection}
      onSelectionChange={setSelection}
      maxHeight="260px"
      empty={
        <EmptyState
          icon={<Inbox />}
          title="Chưa có thiết bị"
          description="Thêm thiết bị hoặc nhập từ Excel."
        />
      }
      bulkActions={() => (
        <>
          <Button size="sm" variant="outline">
            Sửa hàng loạt
          </Button>
          <Button size="sm" variant="destructive">
            Xóa khỏi kho
          </Button>
        </>
      )}
    />
  )
}

/** /dev/ui — every shared component in every state (dev builds only, fake data). */
export function DevUiPage() {
  const { t } = useTranslation()
  const { theme, setTheme, density, setDensity } = usePreferences()
  const [filter, setFilter] = useState<FilterState>({ q: '', facets: { status: ['down'] } })
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState<'normal' | 'heavy' | null>(null)
  const [{ freshMfa, staleMfa }] = useState(() => ({
    freshMfa: new Date().toISOString(),
    staleMfa: new Date(Date.now() - 10 * 60_000).toISOString(),
  }))

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-card px-4 py-2">
          <h1 className="text-title font-semibold">{t('devUi.title')}</h1>
          <EnvBadge />
          <span className="text-muted-foreground">{t('devUi.subtitle')}</span>
          <div className="ml-auto flex items-center gap-1">
            {(['light', 'dark', 'system'] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={theme === v ? 'default' : 'outline'}
                onClick={() => setTheme(v)}
              >
                {v}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {(['compact', 'comfortable'] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={density === v ? 'default' : 'outline'}
                onClick={() => setDensity(v)}
              >
                {v}
              </Button>
            ))}
          </div>
        </header>

        <main className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
          <Section title="Màu trạng thái — StatusBadge">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
              <StatusBadge status="down" label="Down · từ 09:42" />
            </div>
          </Section>

          <Section title="Tổ chức / khu vực hệ thống / môi trường">
            <div className="flex flex-wrap items-center gap-4">
              {FAKE_ORGS.map((o) => (
                <span key={o.id} className="flex items-center gap-2">
                  <OrgAvatar id={o.id} name={o.name} />
                  <span className="font-semibold">{o.name}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {ORG_COLORS.map((c) => (
                <span
                  key={c}
                  className="rounded-sm px-2 py-0.5 font-mono text-[11px] text-white"
                  style={{ backgroundColor: c }}
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="relative flex items-center gap-2 overflow-hidden rounded-md border border-border px-3 py-2">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-system" />
              <SystemAvatar />
              <span className="rounded-sm bg-system px-1.5 py-0.5 text-[12px] font-semibold text-system-fg">
                Hệ thống
              </span>
              <span className="text-muted-foreground">› Tất cả tổ chức</span>
              <span className="ml-auto">
                <EnvBadge />
              </span>
            </div>
          </Section>

          <Section title="Nút — Button">
            <Row label="Biến thể">
              <Button>Thêm thiết bị</Button>
              <Button variant="outline">Xuất Excel</Button>
              <Button variant="secondary">Phụ</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Xóa khỏi kho</Button>
              <Button variant="link">Link</Button>
            </Row>
            <Row label="Kích thước">
              <Button size="xs">xs</Button>
              <Button size="sm">sm</Button>
              <Button>default</Button>
              <Button size="lg">lg</Button>
              <Button size="icon" aria-label="Thiết bị">
                <Server aria-hidden />
              </Button>
            </Row>
            <Row label="Vô hiệu">
              <Button disabled>Đang lưu…</Button>
              <Button variant="outline" disabled>
                Không có quyền
              </Button>
            </Row>
          </Section>

          <Section title="Form — FormField, PasswordInput, MfaCodeInput">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Hostname" hint="Chữ, số, dấu gạch ngang" required>
                {(f) => <Input {...f} defaultValue="SW-ACC-HQ-01" />}
              </FormField>
              <FormField label="IP quản trị" error="IP 10.72.114.300 không hợp lệ">
                {(f) => <Input {...f} defaultValue="10.72.114.300" className="font-mono" />}
              </FormField>
              <FormField label="Mật khẩu">
                {(f) => <PasswordInput {...f} defaultValue="mat-khau-mau" />}
              </FormField>
              <FormField label="Vô hiệu">
                {(f) => <Input {...f} disabled defaultValue="Chỉ đọc" />}
              </FormField>
              <FormField label="Mã MFA (tự gửi khi đủ 6 số)">
                {(f) => (
                  <MfaCodeInput
                    {...f}
                    value={code}
                    onChange={setCode}
                    onComplete={(c) => toast(`Gửi mã ${c}`)}
                  />
                )}
              </FormField>
              <label className="flex items-center gap-2 self-end pb-2 text-form">
                <Checkbox defaultChecked /> Tôi đã lưu mã khôi phục
              </label>
            </div>
          </Section>

          <Section title="SecretField (dữ liệu giả; mã MFA giả: 123456)">
            <Row label="MFA mới">
              <SecretField
                label="Mật khẩu SSH"
                reveal={async () => 'Sample-Ssh-Pa55w0rd'}
                mfaVerifiedAt={freshMfa}
                verifyMfa={async () => {}}
              />
            </Row>
            <Row label="MFA > 5 phút">
              <SecretField
                label="Mật khẩu FortiCloud"
                reveal={async () => 'Sample-Cloud-2026!'}
                mfaVerifiedAt={staleMfa}
                verifyMfa={async (c) => {
                  if (c !== '123456') throw new Error('wrong code')
                }}
              />
            </Row>
          </Section>

          <Section title="TechText, KeyValueList">
            <Row label="TechText">
              <TechText value="10.72.114.2/24" label="IP quản trị" alwaysCopy />
              <TechText value="00:1B:54:AA:10:2F" label="MAC" alwaysCopy />
              <TechText value="Gi1/0/24" label="Cổng" copy={false} />
            </Row>
            <KeyValueList
              columns={2}
              items={[
                { label: 'Model', value: 'C9200-24P' },
                { label: 'S/N', value: <TechText value="FOC2312X0AB" label="S/N" /> },
                { label: 'Firmware', value: 'IOS-XE 17.9.4' },
                { label: 'Bảo hành', value: 'hết 30/11/2026' },
              ]}
            />
          </Section>

          <Section title="StatCard, PageHeader">
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="Thiết bị" value={1284} to="#" />
              <StatCard
                label="Down"
                value={3}
                tone="down"
                icon={<CircleX aria-hidden className="size-3.5 text-status-down" />}
                to="#"
              />
              <StatCard
                label="Cảnh báo"
                value={12}
                tone="warning"
                icon={<TriangleAlert aria-hidden className="size-3.5 text-status-warning" />}
              />
              <StatCard label="Thiếu S/N" value={27} />
            </div>
            <PageHeader
              title="Thiết bị"
              count={1284}
              description="Mô tả ngắn của trang."
              actions={
                <>
                  <Button variant="outline">Xuất Excel</Button>
                  <Button>Thêm thiết bị</Button>
                </>
              }
            />
          </Section>

          <Section title="EmptyState, Skeleton">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border border-border">
                <EmptyState
                  icon={<Inbox />}
                  title="Chưa có dữ liệu"
                  description="Thêm mục đầu tiên để bắt đầu."
                  action={<Button size="sm">Thêm</Button>}
                />
              </div>
              <div className="space-y-2 rounded-md border border-border p-3" aria-busy>
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          </Section>

          <Section title="ConfirmDialog (2 mức), Toast, cảnh báo hết phiên">
            <Row label="Xác nhận">
              <Button variant="outline" onClick={() => setConfirm('normal')}>
                Mức 1 — Gỡ thành viên
              </Button>
              <Button variant="outline" onClick={() => setConfirm('heavy')}>
                Mức 2 — Xóa tổ chức
              </Button>
            </Row>
            <Row label="Toast">
              <Button variant="outline" onClick={() => toast('Đã lưu thay đổi')}>
                Thông tin
              </Button>
              <Button variant="outline" onClick={() => toast.success('Đã copy')}>
                Thành công
              </Button>
              <Button variant="outline" onClick={() => toast.error('Không lưu được (HTTP 409)')}>
                Lỗi
              </Button>
            </Row>
            <div className="overflow-hidden rounded-md border border-border">
              <ExpiryNotice
                leftMs={119_000}
                absolute={false}
                onExtend={() => toast('Gia hạn')}
                onSignIn={() => {}}
              />
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <ExpiryNotice
                leftMs={60_000}
                absolute
                onExtend={() => {}}
                onSignIn={() => toast('Đăng nhập lại')}
              />
            </div>
          </Section>

          <Section title="FilterBar">
            <FilterBar
              value={filter}
              onChange={setFilter}
              searchPlaceholder="Hostname, IP, S/N…"
              storageKey="ntb-filters:dev:demo"
              facets={[
                {
                  id: 'site',
                  label: 'Site',
                  options: [
                    { value: 'hq', label: 'HQ Hà Nội', count: 61 },
                    { value: 'dn', label: 'CN Đà Nẵng', count: 22 },
                  ],
                },
                {
                  id: 'status',
                  label: 'Trạng thái',
                  options: STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
                },
              ]}
            />
            <Button variant="link" size="sm" onClick={() => setFilter(emptyFilter)}>
              Đặt lại
            </Button>
          </Section>

          <div id="datatable" className="space-y-4 xl:col-span-2">
            <Section title="DataTable — có dữ liệu, đang chọn 2 dòng">
              <TableDemo state="data" />
            </Section>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Section title="DataTable — đang tải">
                <TableDemo state="loading" />
              </Section>
              <Section title="DataTable — rỗng">
                <TableDemo state="empty" />
              </Section>
              <Section title="DataTable — lỗi">
                <TableDemo state="error" />
              </Section>
            </div>
          </div>
        </main>

        <ConfirmDialog
          open={confirm === 'normal'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Gỡ moi@vanphongmau.vn khỏi tổ chức?"
          description="Người này mất quyền truy cập Văn phòng mẫu ngay lập tức."
          confirmLabel="Gỡ khỏi tổ chức"
          onConfirm={() => setConfirm(null)}
        />
        <ConfirmDialog
          open={confirm === 'heavy'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Xóa tổ chức Công ty Khách hàng A?"
          description="Tổ chức bị xóa mềm; dữ liệu và audit log được giữ lại."
          consequences={[
            '6 thành viên mất quyền truy cập',
            '312 thiết bị, 4 sơ đồ bị ẩn',
            'Link chia sẻ bị vô hiệu hóa',
          ]}
          confirmText="Công ty Khách hàng A"
          confirmLabel="Xóa tổ chức"
          onConfirm={() => setConfirm(null)}
        />
      </div>
    </TooltipProvider>
  )
}
