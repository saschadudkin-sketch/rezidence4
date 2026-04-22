# AdminFeaturesView

Feature flags management interface for DomHub v2.0 administrators.

## Overview

The AdminFeaturesView provides a settings interface where platform administrators can toggle v2.0 features on/off for their property. Features are organized by category and each has clear descriptions of functionality.

## Features

### Categories
- **Основные** (Core): Chat (always on, not toggleable)
- **Коммуникация** (Communication): Announcements, documents, kiosk mode
- **Доступ** (Access): QR passes  
- **Для жильцов** (Residents): Meter readings, billing, space booking
- **Консьерж** (Concierge): Packages
- **Уведомления** (Notifications): Telegram bot
- **Интеграции** (Integrations): Webhooks, SKUD integration
- **Администрирование** (Administration): Analytics

### UI Features
- Premium toggle component with smooth animations
- Loading skeletons while fetching settings
- Optimistic updates with error rollback
- Error states with retry functionality
- Responsive grid layout
- Accessibility support (keyboard navigation, screen readers)

## API Integration

- **GET** `/api/v1/admin/feature-flags` - Fetch current settings
- **PATCH** `/api/v1/admin/feature-flags` - Update specific flag

## Context Integration

The feature flags are managed through `FeatureFlagsContext` which:
- Fetches flags on mount for admin users
- Provides `useFeatureFlag()` and `useFeatureFlags()` hooks  
- Handles optimistic updates with error rollback
- Falls back to defaults in demo mode or on errors

## Navigation

Accessible via the "Настройки" tab in the admin navigation panel. Added to admin role manifest and navigation metadata.

## Testing

- Unit tests for Toggle component (keyboard, mouse, disabled states)
- Integration tests for AdminFeaturesView component
- Mocked API and authentication for isolated testing