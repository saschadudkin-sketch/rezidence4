'use strict';

const authRouter = require('../routes/auth');
const requestsRouter = require('../routes/requests');
const usersRouter = require('../routes/users');
const chatRouter = require('../routes/chat');
const permsRouter = require('../routes/perms');
const templatesRouter = require('../routes/templates');
const blacklistRouter = require('../routes/blacklist');
const visitLogsRouter = require('../routes/visitLogs');
const uploadRouter = require('../routes/upload');
const clientLogsRouter = require('../routes/clientLogs');
const requireAuth = require('../middleware/auth');
const { deprecate } = require('../middleware/deprecate');
const sse = require('../sse');

function registerApiRoutes(app, { rateLimiters }) {
  const {
    authLimiter,
    uploadLimiter,
    clientLogsLimiter,
    sseEventsLimiter,
  } = rateLimiters;

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/requests', requestsRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/chat', chatRouter);

  app.get('/api/v1/events', requireAuth, sseEventsLimiter, (req, res) => {
    const { uid, role } = req.user;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');
    sse.addClient(uid, res, role);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); }
      catch { clearInterval(ping); sse.removeClient(uid, res); }
    }, 25_000);
    const cleanup = () => { clearInterval(ping); sse.removeClient(uid, res); };
    req.on('close', cleanup);
    res.on('error', cleanup);
  });

  app.use('/api/v1/perms', permsRouter);
  app.use('/api/v1/templates', templatesRouter);
  app.use('/api/v1/blacklist', blacklistRouter);
  app.use('/api/v1/visit-logs', visitLogsRouter);
  app.use('/api/v1/upload', uploadLimiter, uploadRouter);
  app.use('/api/v1/client-logs', clientLogsLimiter, clientLogsRouter);
  app.use('/api/client-logs', clientLogsLimiter, clientLogsRouter);

  app.use('/api/auth', deprecate, authLimiter, authRouter);
  app.use('/api/requests', deprecate, requestsRouter);
  app.use('/api/users', deprecate, usersRouter);
  app.use('/api/chat', deprecate, chatRouter);
  app.use('/api/perms', deprecate, permsRouter);
  app.use('/api/templates', deprecate, templatesRouter);
  app.use('/api/blacklist', deprecate, blacklistRouter);
  app.use('/api/visit-logs', deprecate, visitLogsRouter);
  app.use('/api/upload', deprecate, uploadLimiter, uploadRouter);
}

module.exports = {
  registerApiRoutes,
};
