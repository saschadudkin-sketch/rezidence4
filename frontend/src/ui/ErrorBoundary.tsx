import React, { Component } from 'react';
import { AppIcon } from './AppIcon';
import { logger } from '../services/logger';

/**
 * ErrorBoundary — перехватывает ошибки рендера в дочерних компонентах.
 * Без него ошибка в ChatView / ReqCard крэшит всё приложение.
 *
 * Использование:
 *   <ErrorBoundary name="Чат">
 *     <ChatView />
 *   </ErrorBoundary>
 */
interface EBProps { name?: string; fallback?: React.ReactNode; children?: React.ReactNode; key?: string | number | null; }
interface EBState { hasError: boolean; error: Error | null; resetKey: number; }

export default class ErrorBoundary extends Component<EBProps, EBState> {
  declare state: EBState;
  declare props: EBProps & { children?: React.ReactNode };
  declare setState: (updater: (s: EBState) => Partial<EBState>) => void;

  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error, resetKey: 0 };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error(`[ErrorBoundary: ${this.props.name ?? 'App'}]`, { message: error?.message, stack: info.componentStack });
  }

  render() {
    if (!this.state.hasError) {
      // resetKey форсирует remount детей при сбросе ошибки
      return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
    }

    const { fallback, name = 'Компонент' } = this.props;

    if (fallback) return fallback;

    // UI-01: inline styles replaced with CSS classes (eb-card, eb-icon, eb-title, etc.)
    return (
      <div className="eb-card">
        <div className="eb-icon"><AppIcon name="alert" size={28} /></div>
        <div className="eb-title">{name} не смог загрузиться</div>
        <div className="eb-message">
          {(import.meta?.env?.PROD === true)
            ? 'Что-то пошло не так. Попробуйте обновить страницу.'
            : (this.state.error?.message ?? 'Неизвестная ошибка')}
        </div>
        <button
          className="eb-retry-btn"
          // FIX [BUG]: сброс state без remount = повторный краш на тех же данных.
          // resetKey++ форсирует remount дочерних компонентов через key prop.
          onClick={() => this.setState(s => ({ hasError: false, error: null, resetKey: s.resetKey + 1 }))}
        >
          Попробовать снова
        </button>
      </div>
    );
  }
}
