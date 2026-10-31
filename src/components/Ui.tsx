import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';

export function Button({
  children,
  primary = false,
  busy = false,
  blocked = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  busy?: boolean;
  blocked?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy || blocked}
      data-blocked={(blocked && !props.disabled && !busy) || undefined}
      className={`button ${primary ? 'primary' : ''} ${className}`}
      type={props.type ?? 'button'}
    >
      {busy ? <LoaderCircle size={18} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return children ? (
    <div className="notice" role="alert">
      <AlertCircle size={18} />
      <span>{children}</span>
    </div>
  ) : null;
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h1>{title}</h1>
      {children ? <div className="empty-content">{children}</div> : null}
    </div>
  );
}
export function Pagination({
  page,
  pages,
  onChange,
  count,
  label = 'photos',
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  count: number;
  label?: string;
}) {
  return (
    <div className="pagination">
      <span>
        {count} {label}
      </span>
      <div>
        <span>
          Page {Math.min(page + 1, Math.max(1, pages))} of {Math.max(1, pages)}
        </span>
        <Button aria-label="Previous page" disabled={page === 0} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={20} />
        </Button>
        <Button
          aria-label="Next page"
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={20} />
        </Button>
      </div>
    </div>
  );
}
