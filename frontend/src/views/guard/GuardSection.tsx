import type { ReactNode } from 'react';

type GuardSectionProps = {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
};

export default function GuardSection({ title, icon, count, children }: GuardSectionProps) {
  if (count === 0) return null;

  return (
    <div className="guard-section">
      <div className="guard-section-head">
        <span className="u-inline-icon">{icon} <span>{title}</span></span>
        <span className="guard-section-count">{count}</span>
      </div>
      <div className="guard-list">{children}</div>
    </div>
  );
}
