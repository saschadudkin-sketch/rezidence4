/**
 * views/guard/GuardSection.jsx — T-05: extracted from GuardPostMode.jsx
 * Секция-обёртка со заголовком и счётчиком.
 */

// GuardSection не имеет тяжёлых дочерних хуков — children рендерятся снаружи.
// memo здесь не нужен: мемоизация идёт на уровне дочерних GuardCard/TechCard.
export default function GuardSection({ title, icon, count, children }) {
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
