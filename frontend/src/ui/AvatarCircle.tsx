import { ROLE_COLOR } from '../constants';
import type { UserRole } from '../store/slices/usersSlice';

type AvatarData = { type?: 'photo' | string; src?: string | null } | string | null | undefined;
type AvatarCircleProps = {
  avData?: AvatarData;
  role?: UserRole | null;
  name: string;
  size: number;
  fontSize: number;
};

// FIX [PERF]: константные части стиля вынесены на уровень модуля —
// не создают новый объект при каждом рендере компонента
const BASE_STYLE = {
  borderRadius: '50%', flexShrink: 0,
  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function AvatarCircle({ avData, role, name, size, fontSize }: AvatarCircleProps) {
  const sizeStyle = { width: size, height: size };
  const alt = `Фото профиля: ${name}`;

  if (typeof avData === 'string' && avData) {
    return <div style={{ ...BASE_STYLE, ...sizeStyle }}><img src={avData} alt={alt} className="u-cover" /></div>;
  }

  if (avData && typeof avData === 'object' && avData.type === 'photo' && avData.src)
    return <div style={{ ...BASE_STYLE, ...sizeStyle }}><img src={avData.src} alt={alt} className="u-cover" /></div>;

  const bg = role ? ROLE_COLOR[role as keyof typeof ROLE_COLOR] : 'var(--g-bg)';
  const textColor = role ? '#fff' : 'var(--g2)';

  return (
    <div style={{ ...BASE_STYLE, ...sizeStyle, background: bg, fontFamily: "'Playfair Display',serif", fontSize, color: textColor }}>
      {name.charAt(0)}
    </div>
  );
}
