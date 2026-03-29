import { ROLE_COLOR } from '../constants';

// FIX [PERF]: константные части стиля вынесены на уровень модуля —
// не создают новый объект при каждом рендере компонента
const BASE_STYLE = {
  borderRadius: '50%', flexShrink: 0,
  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function AvatarCircle({ avData, role, name, size, fontSize }) {
  const sizeStyle = { width: size, height: size };

  if (avData && avData.type === 'photo' && avData.src)
    return <div style={{ ...BASE_STYLE, ...sizeStyle }}><img src={avData.src} alt="" className="u-cover" /></div>;

  const bg        = ROLE_COLOR[role] || 'var(--g-bg)';
  const textColor = role ? '#fff' : 'var(--g2)';

  return (
    <div style={{ ...BASE_STYLE, ...sizeStyle, background: bg, fontFamily: "'Playfair Display',serif", fontSize, color: textColor }}>
      {name.charAt(0)}
    </div>
  );
}
