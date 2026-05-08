import React, { useState } from 'react';
import { Card } from '../../ui';
import { Toggle } from '../../ui';
import { Spinner } from '../../ui';
import { EmptyState } from '../../ui';
import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import type { FeatureFlagKey, FlagMeta } from '../../contexts/FeatureFlagsContext';
import { toast } from '../../ui/Toasts';
import styles from './AdminFeaturesView.module.css';

/**
 * AdminFeaturesView — property admin screen for toggling feature flags.
 *
 * Category labels, flag labels, and flag descriptions all come from the
 * backend schema via FeatureFlagsContext (see contexts/FeatureFlagsContext).
 * Do NOT hardcode presentation strings here — add them to the backend
 * registry at backend/src/config/featureFlags.js so the admin surface stays
 * in lock-step with the gating rules that consume the same registry.
 */

// Loading skeleton card
function SkeletonCard() {
  return (
    <Card padding="lg" className={styles.skeletonCard}>
      <div className={styles.skeletonHeader} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonText} />
          <div className={styles.skeletonToggle} />
        </div>
      ))}
    </Card>
  );
}

interface FeatureRowProps {
  flagKey: FeatureFlagKey;
  label: string;
  description: string;
  value: boolean;
  isDisabled: boolean;
  isUpdating: boolean;
  onToggle: (flagKey: FeatureFlagKey, value: boolean) => void;
}

function FeatureRow({
  flagKey,
  label,
  description,
  value,
  isDisabled,
  isUpdating,
  onToggle,
}: FeatureRowProps) {
  const labelId = `feature-flag-${flagKey}-label`;
  const descriptionId = description ? `feature-flag-${flagKey}-description` : undefined;

  return (
    <div className={styles.featureRow}>
      <div className={styles.featureContent}>
        <div id={labelId} className={styles.featureLabel}>{label}</div>
        <div id={descriptionId} className={styles.featureDescription}>{description}</div>
      </div>
      <div className={styles.featureControl}>
        {isUpdating ? (
          <Spinner size="sm" />
        ) : (
          <Toggle
            checked={value}
            onChange={(newValue) => onToggle(flagKey, newValue)}
            disabled={isDisabled}
            size="md"
            ariaLabelledBy={labelId}
            ariaDescribedBy={descriptionId}
          />
        )}
      </div>
    </div>
  );
}

export function AdminFeaturesView() {
  const { flagsMeta, categories, isLoaded, loadError, updateFlag } = useFeatureFlags();
  const [updatingFlags, setUpdatingFlags] = useState<Set<FeatureFlagKey>>(new Set());

  const handleToggleFlag = async (flagKey: FeatureFlagKey, value: boolean) => {
    // Locked flags (core features) are server-enforced; the context already
    // refuses, but we also short-circuit here so a toast never appears.
    if (flagsMeta[flagKey]?.locked) return;

    setUpdatingFlags(prev => new Set(prev).add(flagKey));

    try {
      await updateFlag(flagKey, value);
      toast('Настройки сохранены', 'success');
    } catch {
      toast('Не удалось сохранить настройки', 'error');
    } finally {
      setUpdatingFlags(prev => {
        const next = new Set(prev);
        next.delete(flagKey);
        return next;
      });
    }
  };

  // Group flags by the category string from the backend schema.  The order
  // inside each group mirrors the registry's insertion order — which is
  // what FEATURE_KEYS preserves — so admins see a stable layout that only
  // changes when the backend adds a flag.
  const flagsByCategory = (Object.values(flagsMeta) as FlagMeta[]).reduce((acc, meta) => {
    (acc[meta.category] ||= []).push(meta);
    return acc;
  }, {} as Record<string, FlagMeta[]>);

  // Order categories using the schema's `order` field; unknown categories
  // (shouldn't normally happen — the backend test catches drift) sink to
  // the bottom so the UI still renders them rather than swallowing flags.
  const orderedCategoryKeys = Object.keys(flagsByCategory).sort((a, b) => {
    const orderA = categories.find(c => c.key === a)?.order ?? 999;
    const orderB = categories.find(c => c.key === b)?.order ?? 999;
    return orderA - orderB;
  });

  if (!isLoaded) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Настройки функций</h1>
          <p className={styles.subtitle}>
            Включайте только те возможности, которые нужны вашему объекту
          </p>
        </div>
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Настройки функций</h1>
        </div>
        <EmptyState
          title="Не удалось загрузить настройки"
          subtitle={loadError}
          action={{ label: 'Обновить', onClick: () => window.location.reload() }}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Настройки функций</h1>
        <p className={styles.subtitle}>
          Включайте только те возможности, которые нужны вашему объекту
        </p>
      </div>

      <div className={styles.categoriesGrid}>
        {orderedCategoryKeys.map(categoryKey => {
          // Backend-supplied label; fallback to the raw key if the category
          // is missing from the schema so the flag never gets orphaned.
          const categoryLabel = categories.find(c => c.key === categoryKey)?.label ?? categoryKey;
          const categoryFlags = flagsByCategory[categoryKey];
          if (!categoryFlags?.length) return null;

          return (
            <Card key={categoryKey} padding="lg" className={styles.categoryCard}>
              <div className={styles.categoryHeader}>
                <h2 className={styles.categoryTitle}>{categoryLabel}</h2>
              </div>
              <div className={styles.categoryFeatures}>
                {categoryFlags.map(meta => (
                  <FeatureRow
                    key={meta.key}
                    flagKey={meta.key}
                    label={meta.label}
                    description={meta.description}
                    value={meta.value}
                    isDisabled={meta.locked}
                    isUpdating={updatingFlags.has(meta.key)}
                    onToggle={handleToggleFlag}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
