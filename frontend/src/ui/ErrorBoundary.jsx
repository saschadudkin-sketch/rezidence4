import React, { Component } from 'react';

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

    return (
      <div style={{
        padding: '24px 20px',
        margin: '12px 0',
        background: 'var(--s2)',
        border: '1px solid rgba(220,60,60,.25)',
        borderRadius: 'var(--r)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)', marginBottom: 6 }}>
          {name} не смог загрузиться
        </div>
        <div style={{ fontSize: 12, color: 'var(--t4)', marginBottom: 16 }}>
          {this.state.error?.message ?? 'Неизвестная ошибка'}
        </div>
        <button
          // FIX [BUG]: сброс state без remount = повторный краш на тех же данных.
          // resetKey++ форсирует remount дочерних компонентов через key prop.
          onClick={() => this.setState(s => ({ hasError: false, error: null, resetKey: s.resetKey + 1 }))}
          style={{
            background: 'var(--g-bg)',
            border: '1px solid var(--b2)',
            borderRadius: 6,
            color: 'var(--g2)',
            padding: '7px 16px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Попробовать снова
        </button>
      </div>
    );
  }
}
