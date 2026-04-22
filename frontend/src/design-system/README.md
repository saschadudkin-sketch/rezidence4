# DomHub v2.0 Design System

Premium dark theme design system for residential complex management platform.

## Quick Start

```typescript
import { Button, Card, Badge, tokens } from '../design-system';

// Use components
<Button variant="primary" size="md" loading={false}>
  Submit Request
</Button>

<Card variant="elevated" padding="lg">
  <Badge variant="success">Approved</Badge>
</Card>

// Access tokens in JavaScript
const goldColor = tokens.colors.accentGold;
```

## Components

- **Button** - Primary, secondary, ghost, danger variants with loading states
- **Card** - Surface containers with elevation and accent variants
- **Badge** - Status indicators with semantic colors
- **Input** - Form inputs with labels, validation, and clear functionality
- **Avatar** - User avatars with initials and deterministic colors
- **StatusPill** - Request status indicators with localized labels
- **Spinner** - Loading indicators with customizable size and color
- **EmptyState** - Empty state layouts with icons and actions

## Design Tokens

CSS custom properties and TypeScript constants for:

- **Colors** - Dark premium palette with gold accents
- **Typography** - Inter font family with semantic scales
- **Spacing** - Consistent 4px base grid system
- **Shadows** - Layered elevation system
- **Transitions** - Smooth micro-interactions

## Usage Guidelines

1. Import from single entry point: `import { Component } from '../design-system'`
2. Components follow ARIA accessibility standards
3. All interactive elements support keyboard navigation
4. Responsive design with mobile-first approach
5. Optimized for dark theme with light theme fallbacks