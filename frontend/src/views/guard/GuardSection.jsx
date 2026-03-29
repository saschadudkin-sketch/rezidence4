/**
 * views/guard/GuardSection.jsx — FIX [R2]: extracted from GuardPostMode
 */
export default function GuardSection({ title, icon, count, children }) {
  if (count === 0) return null;
  return (
    <div className="guard-section">
      <div className="guard-section-head">
        <span>{icon} {title}</span>
        <span className="guard-section-count">{count}</span>
      </div>
      <div className="guard-list">{children}</div>
    </div>
  );
}
