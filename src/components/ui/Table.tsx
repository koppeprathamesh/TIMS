import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

// Bordered table with a shaded header; scrolls horizontally on small screens.
export function Table({
  caption,
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLTableElement> & { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={`data-table ${className}`.trim()} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th(props: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" {...props} />;
}

export function Td(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} />;
}
