import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZES = [10, 25, 50, 75, 100] as const;
export type PageSize = typeof PAGE_SIZES[number];

export function useTablePagination<T>(items: T[], defaultPageSize: PageSize = 25) {
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [page, setPage]         = useState(1);

  const total      = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage   = Math.min(page, totalPages);

  useEffect(() => { setPage(1); }, [total, pageSize]);

  const sliced = items.slice((safePage - 1) * pageSize, safePage * pageSize);

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
  }

  return { page: safePage, pageSize, totalPages, sliced, total, setPage, changePageSize };
}

interface TablePagBarProps {
  page:           number;
  pageSize:       number;
  totalPages:     number;
  total:          number;
  setPage:        (p: number) => void;
  changePageSize: (s: PageSize) => void;
}

export function TablePagBar({
  page, pageSize, totalPages, total, setPage, changePageSize,
}: TablePagBarProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-2.5 py-1.5 text-[11px] text-muted-foreground select-none">
      <div className="flex min-w-0 items-center gap-2">
        <span>Rows per page</span>
        <select
          value={pageSize}
          onChange={(e) => changePageSize(Number(e.target.value) as PageSize)}
          className="h-6 rounded border border-white/10 bg-card px-1.5 text-[11px] text-foreground focus:outline-none cursor-pointer"
        >
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular-nums">{from}–{to} of {total.toLocaleString()}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="tabular-nums px-1">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
