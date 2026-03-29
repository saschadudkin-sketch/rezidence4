# Деплой на Timeweb VPS — пошаговая инструкция

## Что получится в итоге

```
Интернет
   │
   ▼
[Сервер Timeweb]  :80
   ├── frontend  — React-приложение (nginx)
   ├── backend   — Node.js API         :3001
   └── db        — PostgreSQL
```

Жильцы открывают сайт по IP сервера, логинятся через SMS, охрана видит заявки в реальном времени.

---

## Шаг 1. Создать VPS на Timeweb

1. Войдите в панель Timeweb → **Облачные серверы** → **Создать сервер**
2. Выберите: **Ubuntu 22.04**, минимум **2 GB RAM** (для 300 пользователей достаточно)
3. Запишите **IP-адрес** сервера

---

## Шаг 2. Подключиться и установить Docker

```bash
ssh root@YOUR_SERVER_IP

# Установить Docker
curl -fsSL https://get.docker.com | sh

# Установить Docker Compose Plugin
apt-get install -y docker-compose-plugin

# Проверить
docker --version && docker compose version
```

---

## Шаг 3. Загрузить проект на сервер

**На вашем компьютере** (в папке с архивом):
```bash
scp residenze_full.zip root@YOUR_SERVER_IP:/root/
```

**На сервере:**
```bash
apt-get install -y unzip
cd /root
unzip residenze_full.zip
cd residenze_full
```

---

## Шаг 4. Создать файл с настройками

```bash
cp .env.example .env
nano .env
```

Заполните **три обязательных поля**:

```env
DB_PASSWORD=придумайте_пароль_только_буквы_и_цифры
JWT_SECRET=вставьте_32_случайных_символа
BACKEND_URL=http://YOUR_SERVER_IP:3001
FRONTEND_URL=http://YOUR_SERVER_IP
SMSRU_API_ID=STUB
```

Для `JWT_SECRET` выполните прямо на сервере и скопируйте результат:
```bash
openssl rand -hex 32
```

Сохранить файл: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## Шаг 5. Запустить всё

```bash
docker compose up -d --build
```

Первый запуск займёт **3–7 минут** (скачивает образы, ставит npm-пакеты, компилирует React).

Проверить что всё запустилось:
```bash
docker compose ps
```

Должны быть `healthy` или `running` три контейнера: `db`, `backend`, `frontend`.

---

## Шаг 6. Создать первого администратора

```bash
docker compose exec backend node src/seed.js
```

Это создаст администратора с номером `+70000000000`.

**Сразу измените номер** — зайдите в базу:
```bash
docker compose exec db psql -U residenze -d residenze -c \
  "UPDATE users SET phone='+7ВАШИ10ЦИФР', name='Ваше Имя' WHERE role='admin';"
```

---

## Шаг 7. Проверить работу

Откройте в браузере: `http://YOUR_SERVER_IP`

Введите номер администратора → нажмите «Получить SMS-код».

Поскольку `SMSRU_API_ID=STUB`, реальный SMS не придёт — код смотрите в логах:
```bash
docker compose logs backend | grep "STUB"
# Увидите: [sms] STUB — phone=+7... code=123456
```

Введите этот код → вы вошли как администратор.

---

## Шаг 8. Добавить пользователей (жильцов, охрану)

В приложении войдите как администратор → вкладка **Резиденты** → добавить пользователя.

Или напрямую через базу:
```bash
docker compose exec db psql -U residenze -d residenze
```

```sql
INSERT INTO users(uid, phone, name, role, apartment)
VALUES(gen_random_uuid(), '+71234567890', 'Иванов Иван', 'owner', '12');

INSERT INTO users(uid, phone, name, role, apartment)
VALUES(gen_random_uuid(), '+79876543210', 'Петров Сергей', 'security', null);
```

---

## Шаг 9. Подключить реальные SMS (когда будете готовы)

1. Зарегистрируйтесь на [sms.ru](https://sms.ru)
2. Пополните баланс (~ 1-2 руб./SMS)
3. Скопируйте **API ID** из раздела Настройки → API
4. В файле `.env` замените `SMSRU_API_ID=STUB` на ваш реальный ID
5. Перезапустите backend:
```bash
docker compose restart backend
```

---

## Полезные команды

```bash
# Посмотреть логи всех сервисов
docker compose logs -f

# Логи только backend (включая коды OTP в режиме STUB)
docker compose logs -f backend

# Перезапустить один сервис
docker compose restart backend

# Обновить после изменений кода
docker compose up -d --build

# Остановить всё
docker compose down

# Остановить и удалить данные (ОСТОРОЖНО — удалит базу!)
docker compose down -v
```

---

## Если что-то не работает

**Сайт не открывается по IP:**
```bash
docker compose ps          # проверить что frontend запущен
docker compose logs frontend  # смотреть ошибки nginx
```

**SMS-коды не приходят:**
```bash
docker compose logs backend | grep -i sms   # проверить статус отправки
```

**Ошибка "Номер не зарегистрирован":**
Пользователь ещё не добавлен в базу. Добавьте через интерфейс администратора или SQL выше.

**База не поднимается:**
```bash
docker compose logs db   # смотреть ошибки postgres
```
