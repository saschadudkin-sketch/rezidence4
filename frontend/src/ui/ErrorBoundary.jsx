import React, { Component } from 'react';
import { AppIcon } from './AppIcon';

/**
 * ErrorBoundary — перехватывает ошибки рендера в дочерних компонентах.
 * Без него ошибка в ChatView / ReqCard крэшит всё приложение.
 *
 * Использование:
 *   <ErrorBoundary name="Чат">
 *     <ChatView />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary: ${this.props.name ?? 'App'}]`, error, info.componentStack);
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
