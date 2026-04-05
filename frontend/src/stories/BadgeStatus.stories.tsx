import BadgeStatus from '../ui/BadgeStatus';

export default {
  title: 'UI/BadgeStatus',
  component: BadgeStatus,
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['pending', 'approved', 'rejected', 'arrived', 'expired', 'cancelled', 'scheduled'],
    },
    role: {
      control: 'select',
      options: ['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'],
    },
    size: {
      control: 'radio',
      options: ['md', 'sm'],
    },
  },
};

export const StatusPending  = { args: { status: 'pending'  } };
export const StatusApproved = { args: { status: 'approved' } };
export const StatusRejected = { args: { status: 'rejected' } };
export const StatusArrived  = { args: { status: 'arrived'  } };
export const StatusExpired  = { args: { status: 'expired'  } };

export const RoleOwner    = { args: { role: 'owner'    } };
export const RoleAdmin    = { args: { role: 'admin'    } };
export const RoleSecurity = { args: { role: 'security' } };

export const AllStatuses = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {['pending', 'approved', 'rejected', 'arrived', 'expired', 'cancelled', 'scheduled'].map(s => (
        <BadgeStatus key={s} status={s} />
      ))}
    </div>
  ),
  name: 'All Statuses',
};

export const AllRoles = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'].map(r => (
        <BadgeStatus key={r} role={r} />
      ))}
    </div>
  ),
  name: 'All Roles',
};
