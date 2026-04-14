import { LOGO } from '../../constants/logo';
import { AppIcon } from '../../ui/AppIcon';

export function LoginArt() {
  return (
    <div className="login-art" aria-hidden="true">
      <div className="login-art-brand">
        <img src={LOGO} alt="Резиденции Замоскворечья" className="login-art-logo" />
        <div>
          <div className="login-art-name">Резиденции Замоскворечья</div>
          <div className="login-art-tagline">Приватная система доступа и сервиса</div>
        </div>
      </div>
      <div className="login-art-body">
        <div className="login-art-kicker">Закрытое приложение резиденции</div>
        <div className="login-art-headline">
          Элегантное управление
          <br />
          доступом
        </div>
        <div className="login-art-intro">
          <p className="login-art-lead">
            Персональное закрытое приложение для жителей и персонала, ваш ключ к безупречному
            сервису.
          </p>
          <ul className="login-art-list">
            <li>Интеллектуальное оформление гостевых пропусков</li>
            <li>Удобные сервисные обращения с отслеживанием статуса</li>
            <li>Мгновенная связь с консьерж-службой и охраной</li>
            <li>Персонализированные уведомления</li>
          </ul>
        </div>
        <div className="login-art-metrics" aria-hidden="true">
          <div className="login-art-metric">
            <span className="login-art-metric-value">24/7</span>
            <span className="login-art-metric-label">консьерж-контур</span>
          </div>
          <div className="login-art-metric">
            <span className="login-art-metric-value">1 app</span>
            <span className="login-art-metric-label">пропуска и сервисы</span>
          </div>
          <div className="login-art-metric">
            <span className="login-art-metric-value">Private</span>
            <span className="login-art-metric-label">защищённый доступ</span>
          </div>
        </div>
        <ul className="login-art-features">
          <li className="login-art-feature">
            <div className="login-art-feature-icon">
              <AppIcon name="ticket" />
            </div>
            <div>
              <div className="login-art-feature-title">Пропуска за секунды</div>
              <div className="login-art-feature-desc">
                Создавайте и отправляйте гостевые пропуска прямо с телефона
              </div>
            </div>
          </li>
          <li className="login-art-feature">
            <div className="login-art-feature-icon">
              <AppIcon name="bell" />
            </div>
            <div>
              <div className="login-art-feature-title">Уведомления в реальном времени</div>
              <div className="login-art-feature-desc">
                Охрана получает пуш-уведомления на заблокированный экран
              </div>
            </div>
          </li>
          <li className="login-art-feature">
            <div className="login-art-feature-icon">
              <AppIcon name="file" />
            </div>
            <div>
              <div className="login-art-feature-title">Постоянные списки</div>
              <div className="login-art-feature-desc">
                Сохраняйте частых гостей и шаблоны заявок
              </div>
            </div>
          </li>
        </ul>
      </div>
      <div className="login-art-footer">
        <div className="login-art-quote">Безопасность и комфорт в одном приложении</div>
      </div>
    </div>
  );
}
