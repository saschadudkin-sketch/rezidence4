import React, { useState } from 'react';
import {
  Button,
  Card,
  Badge,
  StatusPill,
  Avatar,
  EmptyState,
  Spinner
} from '../ui';

const DesignSystemDemo: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const handleLoadingTest = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <div style={{
      padding: '32px',
      maxWidth: '1200px',
      margin: '0 auto',
      background: 'var(--ds-bg-base)',
      color: 'var(--ds-text-primary)',
      fontFamily: 'var(--font-body)'
    }}>
      <h1 style={{
        marginBottom: '48px',
        color: 'var(--ds-text-primary)',
        fontSize: '32px',
        fontWeight: 600
      }}>
        DomHub v2.0 Design System
      </h1>

      {/* Buttons Section */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Buttons</h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading={loading} onClick={handleLoadingTest}>
            {loading ? 'Loading...' : 'Test Loading'}
          </Button>
        </div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <Button size="sm" variant="primary">Small</Button>
          <Button size="md" variant="primary">Medium</Button>
          <Button size="lg" variant="primary">Large</Button>
        </div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="secondary" icon={<span>🏠</span>}>With Icon</Button>
        </div>
      </section>

      {/* Cards Section */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Cards</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          <Card padding="md">
            <h3 style={{ margin: '0 0 8px', color: 'var(--ds-text-primary)' }}>Default Card</h3>
            <p style={{ margin: 0, color: 'var(--ds-text-secondary)' }}>
              This is a standard card with medium padding.
            </p>
          </Card>
          <Card accent padding="md">
            <h3 style={{ margin: '0 0 8px', color: 'var(--ds-text-primary)' }}>Accent Card</h3>
            <p style={{ margin: 0, color: 'var(--ds-text-secondary)' }}>
              This card has a gold accent border.
            </p>
          </Card>
          <Card
            padding="md"
            onClick={() => alert('Card clicked!')}
          >
            <h3 style={{ margin: '0 0 8px', color: 'var(--ds-text-primary)' }}>Clickable Card</h3>
            <p style={{ margin: 0, color: 'var(--ds-text-secondary)' }}>
              This card is clickable and will lift on hover.
            </p>
          </Card>
        </div>
      </section>

      {/* Badges Section */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Badges & Status Pills</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <Badge variant="pending">pending</Badge>
          <Badge variant="approved">approved</Badge>
          <Badge variant="rejected">rejected</Badge>
          <Badge variant="completed">completed</Badge>
          <Badge variant="cancelled">cancelled</Badge>
          <Badge variant="overdue">overdue</Badge>
          <Badge variant="paid">paid</Badge>
          <Badge variant="info">info</Badge>
          <Badge variant="warning">warning</Badge>
        </div>
        <h3 style={{ marginBottom: '12px', color: 'var(--ds-text-primary)' }}>Status Pills (Russian labels)</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <StatusPill status="pending" />
          <StatusPill status="approved" />
          <StatusPill status="rejected" />
          <StatusPill status="completed" />
          <StatusPill status="cancelled" />
          <StatusPill status="overdue" />
          <StatusPill status="paid" />
        </div>
      </section>

      {/* Avatars Section */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Avatars</h2>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
          <Avatar name="Александр Иванов" size="sm" />
          <Avatar name="Maria Rodriguez" size="md" />
          <Avatar name="John Smith" size="lg" />
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Avatar name="Анна Петрова" ring size="sm" />
          <Avatar name="Boris Chen" ring size="md" />
          <Avatar name="Diana Wilson" ring size="lg" />
        </div>
      </section>

      {/* Spinners Section */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Spinners</h2>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Spinner size="sm" variant="primary" />
          <Spinner size="md" variant="primary" />
          <Spinner size="lg" variant="primary" />
          <Spinner size="md" variant="secondary" />
        </div>
      </section>

      {/* Empty State Section */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Empty State</h2>
        <Card padding="lg">
          <EmptyState
            title="No requests found"
            subtitle="Create your first request to get started"
            icon={<span style={{ fontSize: '32px' }}>📄</span>}
            action={{
              label: 'Create Request',
              onClick: () => alert('Create request clicked!')
            }}
          />
        </Card>
      </section>

      {/* Color Palette */}
      <section>
        <h2 style={{ marginBottom: '24px', color: 'var(--ds-text-primary)' }}>Color Palette</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {[
            { name: 'Background Base', var: '--ds-bg-base' },
            { name: 'Background Surface', var: '--ds-bg-surface' },
            { name: 'Background Raised', var: '--ds-bg-raised' },
            { name: 'Accent', var: '--ds-accent' },
            { name: 'Text Primary', var: '--ds-text-primary' },
            { name: 'Text Secondary', var: '--ds-text-secondary' },
            { name: 'Text Muted', var: '--ds-text-muted' },
            { name: 'Success', var: '--ds-success' },
            { name: 'Error', var: '--ds-error' },
            { name: 'Warning', var: '--ds-warning' },
            { name: 'Info', var: '--ds-info' },
          ].map((color) => (
            <div
              key={color.name}
              style={{
                padding: '16px',
                borderRadius: 'var(--ds-radius-md)',
                border: '1px solid var(--ds-border)',
                textAlign: 'center'
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '40px',
                  backgroundColor: `var(${color.var})`,
                  borderRadius: 'var(--ds-radius-sm)',
                  marginBottom: '8px'
                }}
              />
              <div style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>
                {color.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--ds-text-muted)', fontFamily: 'monospace' }}>
                {color.var}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default DesignSystemDemo;