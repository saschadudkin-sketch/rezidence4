import { LOGO } from '../../constants/logo';
import { AppIcon } from '../../ui/AppIcon';

export function LoginArt() {
  return (
    <div className="login-art" aria-hidden="true">
      <div className="login-art-brand">
        <img src={LOGO} alt="" className="login-art-logo" />
        <div>
          <div className="login-art-name">Резиденции<br />Замоскворечья</div>
          <div className="login-art-tagline">Личный кабинет резиденции</div>
        </div>
      </div>
      <div className="login-art-body">
        <div className="login-art-kicker">Всё начинается с дома</div>
        <div className="login-art-headline">Ваш дом.<br /><em>Всё под рукой.</em></div>
        <p className="login-art-lead">Пригласить гостей, обратиться к консьержу и позаботиться о главном — в одном приложении.</p>
        <div className="residence-scene">
          <div className="residence-scene__sun" />
          <div className="residence-scene__building residence-scene__building--back" />
          <div className="residence-scene__building residence-scene__building--front" />
          <div className="residence-scene__tree" />
          <div className="residence-scene__caption"><AppIcon name="ticket" size={18} /><span>Добро пожаловать домой</span></div>
        </div>
      </div>
      <div className="login-art-footer"><span>Пропуска · Сервис · Общение</span><span>Резиденции / Москва</span></div>
    </div>
  );
}
