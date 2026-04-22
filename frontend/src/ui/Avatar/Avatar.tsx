import React from 'react';
import styles from './Avatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  ring?: boolean;
  className?: string;
}

// Deterministic color generation from name
function getAvatarColor(name: string): string {
  const colors = [
    '#6366f1', // indigo
    '#8b5cf6', // violet
    '#a855f7', // purple
    '#d946ef', // fuchsia
    '#ec4899', // pink
    '#f43f5e', // rose
    '#ef4444', // red
    '#f97316', // orange
  ];

  const hash = name.split('').reduce((acc, char) => {
    const charCode = char.charCodeAt(0);
    return ((acc << 5) - acc) + charCode;
  }, 0);

  return colors[Math.abs(hash) % colors.length];
}

// Extract initials from name
function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 'md',
  ring = false,
  className = ''
}) => {
  const avatarClasses = [
    styles.avatar,
    styles[`avatar--${size}`],
    ring && styles['avatar--ring'],
    !src && styles['avatar--initials'],
    className
  ].filter(Boolean).join(' ');

  const backgroundColor = !src ? getAvatarColor(name) : undefined;
  const initials = !src ? getInitials(name) : '';

  return (
    <div
      className={avatarClasses}
      style={{ backgroundColor }}
      title={name}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={styles.image}
          onError={(e) => {
            // Hide image on error, show initials instead
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span className={styles.initials} aria-label={`${name} initials`}>
          {initials}
        </span>
      )}
    </div>
  );
};

export { Avatar as default };