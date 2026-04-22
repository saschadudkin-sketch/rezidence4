import React from 'react';
import { Badge, BadgeVariant, BadgeSize } from '../Badge/Badge';

export interface StatusPillProps {
  status: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

// Russian status labels mapping
const statusLabels: Record<BadgeVariant, string> = {
  pending: 'Ожидает',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  completed: 'Завершено',
  cancelled: 'Отменено',
  overdue: 'Просрочено',
  paid: 'Оплачено',
  info: 'Информация',
  warning: 'Внимание',
};

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  size = 'md',
  className
}) => {
  return (
    <Badge variant={status} size={size} className={className}>
      {statusLabels[status]}
    </Badge>
  );
};

export { StatusPill as default };