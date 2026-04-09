/**
 * SectionHeader.jsx — A-06: Visual language kit.
 * Standardized section header used across all views.
 * Replaces ad-hoc `.divider` + h2 patterns.
 *
 * Usage:
 *   <SectionHeader title="Заявки" count={5} />
 *   <SectionHeader title="Жильцы" action={<button>+ Добавить</button>} />
 */
import { memo } from 'react';
import type { ReactNode } from 'react';

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  count?: number;
  action?: ReactNode;
  className?: string;
};

const SectionHeader = memo(function SectionHeader({ title, subtitle, count, action, className = '' }: SectionHeaderProps) {
  return (
    <div className={'section-header ' + className}>
      <div className="section-header-main">
        <span className="section-header-title">{title}</span>
        {count != null && count > 0 && (
          <span className="section-header-count">{count}</span>
        )}
      </div>
      {subtitle && <p className="section-header-sub">{subtitle}</p>}
      {action && <div className="section-header-action">{action}</div>}
    </div>
  );
});

export default SectionHeader;
