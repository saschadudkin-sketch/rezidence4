/**
 * Avatar Component - DomHub v2.0 Design System
 * User avatar with initials, deterministic colors, and gold ring variant
 */

import { HTMLAttributes, useEffect, useState } from 'react';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'gold-ring';
}

export function Avatar({
  name,
  src,
  size = 'md',
  variant = 'default',
  className = '',
  style,
  ...rest
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  // Size configurations
  const sizeConfig = {
    sm: { size: 32, fontSize: 14 },
    md: { size: 40, fontSize: 16 },
    lg: { size: 56, fontSize: 20 },
  };

  const { size: avatarSize, fontSize } = sizeConfig[size];

  // Generate deterministic color from name
  const generateColorFromName = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    const colors = [
      '#6366F1', // Indigo
      '#8B5CF6', // Violet
      '#EC4899', // Pink
      '#EF4444', // Red
      '#F97316', // Orange
      '#EAB308', // Yellow
      '#22C55E', // Green
      '#06B6D4', // Cyan
      '#3B82F6', // Blue
      '#A855F7', // Purple
    ];

    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string): string => {
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
      return words[0].charAt(0).toUpperCase();
    }
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  };

  const baseStyles = {
    width: avatarSize,
    height: avatarSize,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative' as const,
    overflow: 'hidden',
    userSelect: 'none' as const,
  };

  const ringStyles = variant === 'gold-ring' ? {
    border: '2px solid var(--color-accent-gold)',
    boxShadow: 'var(--shadow-gold)',
  } : {};

  const backgroundColor = generateColorFromName(name);

  if (src && !imageFailed) {
    return (
      <div
        className={`avatar avatar-${size} avatar-${variant} ${className}`}
        style={{
          ...baseStyles,
          ...ringStyles,
          ...style,
        }}
        {...rest}
      >
        <img
          src={src}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`avatar avatar-${size} avatar-${variant} ${className}`}
      style={{
        ...baseStyles,
        backgroundColor,
        color: 'white',
        fontSize,
        fontWeight: 'var(--font-semibold)',
        fontFamily: 'var(--font-sans)',
        ...ringStyles,
        ...style,
      }}
      title={name}
      {...rest}
    >
      {getInitials(name)}
    </div>
  );
}
