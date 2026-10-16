import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_QUERY_KEY } from '@/app/auth'
import { ConfirmDialog } from './ConfirmDialog'
import { DataTable, type DataColumn } from './DataTable'
import { MfaCodeInput } from './MfaCodeInput'
import { SecretField } from './SecretField'
import { SessionExpiryWarning } from './SessionExpiryWarning'
import { StatusBadge } from './StatusBadge'

interface Row {
  id: string
  name: string
  ip: string
}
const ROWS: Row[] = [
  { id: 'a', name: 'SW-01', ip: '10.0.0.1' },
  { id: 'b', name: 'SW-02', ip: '10.0.0.2' },
]
const COLUMNS: DataColumn<Row>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Hostname',
    meta: { label: 'Hostname', width: 120, pin: true, alwaysVisible: true },
  },
  { id: 'ip', accessorKey: 'ip', header: 'IP', meta: { label: 'IP', width: 120 } },
]

function TableHarness({ onSort }: { onSort?: (s: SortingState) => void }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })
  const [sorting, setSorting] = useState<SortingState>([])
  const [selection, setSelection] = useState<RowSelectionState>({})
  return (
    <DataTable
      tableId="t"
      userId="u1"
      caption="Test"
      columns={COLUMNS}
      data={ROWS}
      total={60}
      getRowId={(r) => r.id}
      rowLabel={(r) => r.name}
      pagination={pagination}
      onPaginationChange={setPagination}
      sorting={sorting}
      onSortingChange={(u) => {
        const next = typeof u === 'function' ? u(sorting) : u
        setSorting(next)
        onSort?.(next)
      }}
      selection={selection}
      onSelectionChange={setSelection}
      bulkActions={(ids) => <button type="button">Xóa {ids.length}</button>}
    />
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('DataTable', () => {
  it('selects rows, shows the bulk-action bar and clears it', async () => {
    render(<TableHarness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả dòng trên trang' }))
    const bar = await screen.findByRole('region', { name: 'Đã chọn 2' })
    expect(within(bar).getByRole('button', { name: 'Xóa 2' })).toBeInTheDocument()
    fireEvent.click(within(bar).getByRole('button', { name: 'Bỏ chọn' }))
    expect(screen.queryByRole('region', { name: 'Đã chọn 2' })).not.toBeInTheDocument()
  })

  it('sorts via header buttons and pages on the server total', () => {
    const onSort = vi.fn()
    render(<TableHarness onSort={onSort} />)
    fireEvent.click(screen.getByRole('button', { name: /Hostname/ }))
    expect(onSort).toHaveBeenLastCalledWith([{ id: 'name', desc: false }])
    expect(screen.getByRole('columnheader', { name: /Hostname/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(screen.getByText('1–25 / 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }))
    expect(screen.getByText('26–50 / 60')).toBeInTheDocument()
  })

  it('pins the checkbox and hostname columns for horizontal scrolling', () => {
    render(<TableHarness />)
    const header = screen.getByRole('columnheader', { name: /Hostname/ })
    expect(header.style.position).toBe('sticky')
    expect(header.style.left).toBe('36px') // right after the checkbox column
    expect(screen.getByRole('columnheader', { name: 'IP' }).style.position).toBe('')
  })

  it('remembers hidden columns per user and table', async () => {
    const { unmount } = render(<TableHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Cột' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'IP' }))
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'IP' })).not.toBeInTheDocument(),
    )
    expect(JSON.parse(localStorage.getItem('ntb-columns:u1:t')!)).toEqual({ ip: false })
    unmount()
    render(<TableHarness />)
    expect(screen.queryByRole('columnheader', { name: 'IP' })).not.toBeInTheDocument()
  })
})

describe('ConfirmDialog', () => {
  it('heavy actions need the name typed exactly', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Xóa tổ chức?"
        confirmText="Công ty A"
        confirmLabel="Xóa tổ chức"
        consequences={['6 thành viên mất quyền']}
        onConfirm={onConfirm}
      />,
    )
    const button = await screen.findByRole('button', { name: 'Xóa tổ chức' })
    expect(button).toBeDisabled()
    expect(screen.getByText('6 thành viên mất quyền')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Gõ chính xác/), { target: { value: 'công ty a' } })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Gõ chính xác/), { target: { value: 'Công ty A' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe('MfaCodeInput', () => {
  it('keeps digits only and submits once at six digits', () => {
    const onComplete = vi.fn()
    function Harness() {
      const [v, setV] = useState('')
      return <MfaCodeInput aria-label="Mã" value={v} onChange={setV} onComplete={onComplete} />
    }
    render(<Harness />)
    const input = screen.getByLabelText('Mã')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    fireEvent.change(input, { target: { value: '12a3' } })
    expect(input).toHaveValue('123')
    expect(onComplete).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '123 456 7' } })
    expect(input).toHaveValue('123456')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('123456')
    // Extra keystrokes on a complete code do not submit it again.
    fireEvent.change(input, { target: { value: '1234569' } })
    expect(onComplete).toHaveBeenCalledOnce()
  })
})

describe('StatusBadge', () => {
  it('always pairs colour with text and an icon', () => {
    const { container } = render(<StatusBadge status="down" />)
    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('SecretField', () => {
  const writeText = vi.fn(async (text: string) => void text)
  beforeEach(() => {
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('is masked, reveals with fresh MFA and re-masks after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <SecretField
        label="Mật khẩu SSH"
        reveal={async () => 'S3cret!'}
        mfaVerifiedAt={new Date().toISOString()}
        verifyMfa={async () => {}}
      />,
    )
    expect(screen.queryByText('S3cret!')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hiện Mật khẩu SSH' }))
    expect(await screen.findByText('S3cret!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Che (30)' })).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByRole('button', { name: 'Che (25)' })).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000)
    })
    expect(screen.queryByText('S3cret!')).not.toBeInTheDocument()
  })

  it('asks for a new MFA code when the last check is older than 5 minutes', async () => {
    const reveal = vi.fn(async () => 'S3cret!')
    const verifyMfa = vi.fn(async (code: string) => {
      if (code !== '123456') throw new Error('wrong')
    })
    render(
      <SecretField
        label="Mật khẩu SSH"
        reveal={reveal}
        mfaVerifiedAt={new Date(Date.now() - 6 * 60_000).toISOString()}
        verifyMfa={verifyMfa}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hiện Mật khẩu SSH' }))
    const dialog = await screen.findByRole('dialog', { name: 'Xác thực lại để xem bí mật' })
    expect(reveal).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText('Mã 6 số từ ứng dụng xác thực'), {
      target: { value: '000000' },
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Mã không đúng')
    fireEvent.change(within(dialog).getByLabelText('Mã 6 số từ ứng dụng xác thực'), {
      target: { value: '123456' },
    })
    expect(await screen.findByText('S3cret!')).toBeInTheDocument()
    expect(reveal).toHaveBeenCalledOnce()
  })

  it('clears the clipboard 30 s after copying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <SecretField
        label="Mật khẩu SSH"
        reveal={async () => 'S3cret!'}
        mfaVerifiedAt={new Date().toISOString()}
        verifyMfa={async () => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy Mật khẩu SSH' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('S3cret!'))
    expect(screen.queryByText('S3cret!')).not.toBeInTheDocument() // copy does not reveal
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(writeText).toHaveBeenLastCalledWith('')
  })
})

describe('SessionExpiryWarning', () => {
  function renderWith(expiresAt: string, refetched?: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const session = (exp: string) => ({
      csrfToken: 'c',
      user: { id: 'u', email: 'a@b.co', displayName: 'A', isSystemAdmin: false },
      mfa: { enabled: false, verified: false, required: false },
      activeOrganizationId: null,
      expiresAt: exp,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(session(refetched ?? expiresAt)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    client.setQueryData(SESSION_QUERY_KEY, session(expiresAt))
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionExpiryWarning />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }
  afterEach(() => vi.unstubAllGlobals())

  it('stays hidden while the session has more than 2 minutes left', () => {
    renderWith(new Date(Date.now() + 10 * 60_000).toISOString())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns 2 minutes before expiry and extends the session', async () => {
    renderWith(
      new Date(Date.now() + 90_000).toISOString(),
      new Date(Date.now() + 12 * 3600_000).toISOString(),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Phiên đăng nhập sẽ hết hạn sau 1:(29|30)/)
    fireEvent.click(screen.getByRole('button', { name: 'Gia hạn phiên' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('offers to sign in again when the absolute limit stops the extension', async () => {
    const exp = new Date(Date.now() + 90_000).toISOString()
    renderWith(exp, exp)
    fireEvent.click(screen.getByRole('button', { name: 'Gia hạn phiên' }))
    expect(await screen.findByRole('button', { name: 'Đăng nhập lại' })).toBeInTheDocument()
  })
})
