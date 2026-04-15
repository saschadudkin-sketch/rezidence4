@echo off
cd /d "C:\Users\Alexandr\OneDrive\Documents\New project\rezidence4\backend"
set DATABASE_URL=postgresql://residenze:localDevDbPassword1234567890@127.0.0.1:55432/residenze
set REDIS_URL=redis://:localDevRedisPassword1234567890@127.0.0.1:56379
set JWT_SECRET=local_dev_jwt_secret_0123456789abcdef0123456789abcdef
set UPLOAD_SIGNING_SECRET=local_dev_upload_secret_0123456789abcdef0123456789abcdef
set SMSRU_API_ID=STUB
set BACKEND_URL=http://127.0.0.1:3001
set FRONTEND_URL=http://127.0.0.1:5173
set PORT=3001
set NODE_ENV=development
node src/migrate.js && node src/index.js
