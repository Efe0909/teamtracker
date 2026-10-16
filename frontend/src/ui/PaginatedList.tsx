import { Children, useId, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Button, ui } from "./ui";
import s from "./PaginatedList.module.css";

/** Her dogrudan cocuk bir satir; her listenin sayfasi ve adedi kendine aittir. */
export function PaginatedList({ label, children, empty, className }: {
  label: string;
  children: ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  const rows = Children.toArray(children);
  const [requestedPage, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const listId = useId();
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Odeme sonrasi son sayfa bosalsa da mevcut son sayfayi goster.
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);

  return <>
    <div id={listId} className={className}>
      {rows.length === 0 ? empty : rows.slice(start, end)}
    </div>
    <nav className={s.footer} aria-label={`${label} sayfaları`}>
      <label className={s.pageSize}>
        Sayfada
        <select className={ui.input} aria-label={`${label}: sayfada göster`} value={pageSize}
          onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
          {[5, 10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        göster
      </label>
      <span className={s.range} aria-live="polite">{rows.length === 0 ? "0 kayıt" : `${start + 1}–${end} / ${rows.length}`}</span>
      <div className={s.pages}>
        <Button size="sm" aria-label="Önceki sayfa" aria-controls={listId} disabled={page === 1} onClick={() => setPage(page - 1)}>
          <Icon name="back" size={14} />
        </Button>
        {pages.map((value, index) => <span className={s.page} key={value}>
          {index > 0 && value - (pages[index - 1] ?? value) > 1 && <span className={s.ellipsis}>…</span>}
          <Button size="sm" variant={value === page ? "primary" : "default"} aria-label={`${value}. sayfa`}
            aria-current={value === page ? "page" : undefined} aria-controls={listId} onClick={() => setPage(value)}>{value}</Button>
        </span>)}
        <Button size="sm" aria-label="Sonraki sayfa" aria-controls={listId} disabled={page === pageCount} onClick={() => setPage(page + 1)}>
          <Icon name="chevron" size={14} />
        </Button>
      </div>
    </nav>
  </>;
}
