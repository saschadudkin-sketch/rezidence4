async function stubExternalFontAssets(context) {
  await context.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: '',
    }),
  );
  await context.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'font/woff2',
      body: '',
    }),
  );
}

module.exports = { stubExternalFontAssets };
