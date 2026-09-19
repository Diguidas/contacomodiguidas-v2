import type { ReactNode } from 'react';
import { BrandColors } from '../theme';

/** Elegant pill toggle replacing a plain checkbox/filter chip — selected
 * reads as a solid brand pill, unselected as a quiet outlined one, both a
 * bit taller/rounder than a default chip for a less "form control", more
 * "button" feel. */
export function ToggleChip({
  label,
  selected,
  onSelected,
  icon,
}: {
  label: string;
  selected: boolean;
  onSelected: (selected: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelected(!selected)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 14px',
        borderRadius: 999,
        border: `1px solid ${selected ? BrandColors.primary : BrandColors.border}`,
        backgroundColor: selected ? BrandColors.primary : '#FFFFFF',
        cursor: 'pointer',
        transition: 'background-color 150ms, border-color 150ms',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          fontSize: 15,
          color: selected ? '#FFFFFF' : '#94A3B8',
        }}
      >
        {icon ?? (selected ? '●' : '○')}
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: selected ? '#FFFFFF' : '#334155',
        }}
      >
        {label}
      </span>
    </button>
  );
}

/** A soft, boxed container for an explanatory line + a row of `ToggleChip`s
 * — reads as one coherent filter control instead of a stray tooltip note. */
export function FilterBox({ message, children }: { message: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        backgroundColor: BrandColors.tableHeader,
        border: `1px solid ${BrandColors.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 14, color: '#64748B', lineHeight: '18px' }}>ⓘ</span>
        <p style={{ margin: 0, fontSize: 12, color: '#475569', flex: 1 }}>{message}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{children}</div>
    </div>
  );
}
