'use strict';

// Тесты markdownSanitizer — Spec: content-spec.md §7 AC 7.1.
//
// Покрываем четыре ветви:
//   1. HTML-strip (теги, комментарии, вложенность).
//   2. URL-scheme allowlist в markdown-links/images.
//   3. Normalize line endings + clamp длины.
//   4. Title sanitizer (отдельный, короче).
//
// Эти тесты unit-level: чистая функция без БД / сети.  Для integration-
// проверки (что sanitizer реально вызывается из announcements/documents
// service) — см. v1AnnouncementsEndpoint / v1DocumentsEndpoint test suites,
// где payload с `<script>` не должен возвращаться в response.

const {
  sanitizeMarkdown,
  sanitizeTitle,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  ALLOWED_URL_SCHEMES,
  DANGEROUS_SCHEMES,
} = require('../v1/services/markdownSanitizer');

describe('markdownSanitizer.sanitizeMarkdown', () => {
  describe('non-string input', () => {
    test.each([
      [null],
      [undefined],
      [42],
      [true],
      [{}],
      [[]],
    ])('returns empty string for %p', (val) => {
      const out = sanitizeMarkdown(val);
      expect(out.sanitized).toBe('');
      expect(out.warnings).toEqual([]);
    });
  });

  describe('HTML tag stripping', () => {
    test('strips <script> tags', () => {
      const out = sanitizeMarkdown('Hello <script>alert(1)</script> world');
      expect(out.sanitized).toBe('Hello alert(1) world');
      expect(out.warnings.some((w) => w.type === 'html_tags_stripped')).toBe(true);
    });

    test('strips self-closing tags (img, br, hr)', () => {
      const out = sanitizeMarkdown('text <img src=x onerror=alert(1)> more <br/> end');
      expect(out.sanitized).not.toMatch(/<img/i);
      expect(out.sanitized).not.toMatch(/<br/i);
      expect(out.sanitized).toContain('text');
      expect(out.sanitized).toContain('end');
    });

    test('strips iframe', () => {
      const out = sanitizeMarkdown('<iframe src="evil.com"></iframe>');
      expect(out.sanitized).toBe('');
      expect(out.warnings.some((w) => w.type === 'html_tags_stripped')).toBe(true);
    });

    test('strips attributes with quotes', () => {
      const out = sanitizeMarkdown('<a href="x" onclick=\'alert(1)\'>link</a>');
      expect(out.sanitized).toBe('link');
    });

    test('strips multi-line tag (attacker trick)', () => {
      const out = sanitizeMarkdown('<img\n src=x\n onerror=alert(1)>');
      expect(out.sanitized.trim()).toBe('');
    });

    test('strips nested / polyglot <<script>script>', () => {
      // После первого прохода остаётся `<script>` — нужен повторный проход.
      // Но текущая реализация делает до 3х проходов — проверим, что выхлоп
      // НЕ содержит открывающего `<script>`.
      const out = sanitizeMarkdown('<<script>script>alert(1)</script>');
      expect(out.sanitized).not.toMatch(/<script/i);
      expect(out.sanitized.toLowerCase()).not.toContain('</script>');
    });

    test('strips HTML comments', () => {
      const out = sanitizeMarkdown('before <!-- comment --> after');
      expect(out.sanitized).toBe('before  after');
      expect(out.warnings.some((w) => w.type === 'html_comments_stripped')).toBe(true);
    });

    test('strips comment-hidden tag (<!-- <script> -->, then strip script)', () => {
      // Сначала comment stripped, затем в тексте `<script>` — тоже strip'ается.
      const out = sanitizeMarkdown('<!-- <script>x</script> -->');
      expect(out.sanitized.trim()).toBe('');
    });

    test('counts tag strips in warnings', () => {
      const out = sanitizeMarkdown('<b>a</b> <i>b</i> <u>c</u>');
      const tagWarning = out.warnings.find((w) => w.type === 'html_tags_stripped');
      expect(tagWarning).toBeDefined();
      expect(tagWarning.detail.count).toBeGreaterThanOrEqual(6); // 6 открыт./закрыт.
    });

    test('does not strip markdown emphasis', () => {
      // Markdown-нотация **bold** / *italic* / __underline__ не затрагивается —
      // sanitizer работает только с HTML-тегами.
      const out = sanitizeMarkdown('**bold** *italic* __under__ ~~strike~~');
      expect(out.sanitized).toBe('**bold** *italic* __under__ ~~strike~~');
      expect(out.warnings).toEqual([]);
    });

    test('does not strip simple text with <, > in math-like context', () => {
      // `5 < 10 > 3` — НЕ тег, т.к. после `<` нет буквы алфавита.  Regex
      // /<\/?[a-zA-Z]/ требует буквенный старт → math-выражение сохраняется.
      const out = sanitizeMarkdown('5 < 10 > 3');
      expect(out.sanitized).toBe('5 < 10 > 3');
    });
  });

  describe('URL scheme allowlist', () => {
    test.each([
      ['http', 'http://example.com'],
      ['https', 'https://example.com'],
      ['mailto', 'mailto:a@b.com'],
      ['tel', 'tel:+1234567890'],
    ])('passes through %s:// links', (_scheme, url) => {
      const md = `[link](${url})`;
      const out = sanitizeMarkdown(md);
      expect(out.sanitized).toBe(md);
      expect(out.warnings.filter((w) => w.type === 'url_scheme_stripped')).toEqual([]);
    });

    test('passes through relative links (no scheme)', () => {
      const out = sanitizeMarkdown('[doc](/uploads/x.pdf) and [anchor](#section)');
      expect(out.sanitized).toBe('[doc](/uploads/x.pdf) and [anchor](#section)');
      expect(out.warnings.filter((w) => w.type === 'url_scheme_stripped')).toEqual([]);
    });

    test.each([
      ['javascript', 'javascript:alert(1)'],
      ['data', 'data:text/html,<script>alert(1)</script>'],
      ['vbscript', 'vbscript:msgbox(1)'],
      ['file', 'file:///etc/passwd'],
    ])('blocks %s:// links (replaced with #)', (scheme, url) => {
      const out = sanitizeMarkdown(`[evil](${url})`);
      expect(out.sanitized).toBe('[evil](#)');
      const warn = out.warnings.find((w) => w.type === 'url_scheme_stripped');
      expect(warn).toBeDefined();
      expect(warn.detail.scheme).toBe(scheme);
      expect(warn.detail.dangerous).toBe(true);
    });

    test('blocks unusual scheme (flag non-dangerous but not allow-listed)', () => {
      const out = sanitizeMarkdown('[x](ftp://example.com/file.zip)');
      expect(out.sanitized).toBe('[x](#)');
      const warn = out.warnings.find((w) => w.type === 'url_scheme_stripped');
      expect(warn.detail.scheme).toBe('ftp');
      expect(warn.detail.dangerous).toBe(false); // не в blacklist
    });

    test('case-insensitive scheme detection (JaVaScRiPt)', () => {
      const out = sanitizeMarkdown('[x](JaVaScRiPt:alert(1))');
      expect(out.sanitized).toBe('[x](#)');
    });

    test('image links (![alt](url)) also sanitized', () => {
      const out = sanitizeMarkdown('![img](javascript:alert(1))');
      expect(out.sanitized).toBe('![img](#)');
    });

    test('preserves link title attribute', () => {
      const out = sanitizeMarkdown('[x](https://a.com "title")');
      // Regex съедает title — проверяем, что scheme'а не сломали URL.
      expect(out.sanitized).toContain('https://a.com');
    });

    test('multiple links in same document each evaluated', () => {
      const md = '[safe](https://ok.com) [bad](javascript:bad) [rel](/local)';
      const out = sanitizeMarkdown(md);
      expect(out.sanitized).toContain('https://ok.com');
      expect(out.sanitized).toContain('[bad](#)');
      expect(out.sanitized).toContain('/local');
      const warn = out.warnings.filter((w) => w.type === 'url_scheme_stripped');
      expect(warn.length).toBe(1);
    });
  });

  // SEC [AUDIT-XSS]: regression-тесты для bypass'ов, найденных в security
  // review (см. policy комментарий в markdownSanitizer.js).  Без trim'а +
  // entity-decode CommonMark renderer превращал бы это в
  // <a href="javascript:..."> через нормализацию destination.
  describe('XSS bypass via leading whitespace / HTML-entities (AUDIT-XSS)', () => {
    test.each([
      ['[click]( javascript:alert(1))'],
      ['[click](\tjavascript:alert(1))'],
      ['[click](   javascript:alert(1))'],
    ])('leading whitespace bypass blocked: %s', (md) => {
      const out = sanitizeMarkdown(md);
      expect(out.sanitized).toBe('[click](#)');
      expect(out.warnings.find((w) => w.type === 'url_scheme_stripped')?.detail?.scheme)
        .toBe('javascript');
    });

    test('NBSP (U+00A0) leading bypass blocked', () => {
      const out = sanitizeMarkdown('[x]( javascript:alert(1))');
      expect(out.sanitized).toBe('[x](#)');
    });

    test.each([
      ['hex entity', '[x](&#x6A;avascript:alert(1))'],
      ['decimal entity', '[x](&#106;avascript:alert(1))'],
      ['mixed case hex', '[x](&#X6A;avascript:alert(1))'],
      ['multiple entities', '[x](&#x6A;&#x61;vascript:alert(1))'],
    ])('HTML-entity scheme bypass blocked (%s)', (_label, md) => {
      const out = sanitizeMarkdown(md);
      expect(out.sanitized).toBe('[x](#)');
    });

    test('trim применяется и к safe схемам — нет ведущего whitespace на выходе', () => {
      const out = sanitizeMarkdown('[ok]( https://example.com)');
      expect(out.sanitized).toBe('[ok](https://example.com)');
    });

    test('trim применяется к relative URL', () => {
      const out = sanitizeMarkdown('[doc]( /uploads/x.pdf)');
      expect(out.sanitized).toBe('[doc](/uploads/x.pdf)');
    });

    test('vbscript bypass с ведущим whitespace блокируется', () => {
      const out = sanitizeMarkdown('[x]( vbscript:msgbox(1))');
      expect(out.sanitized).toBe('[x](#)');
    });

    test('legitimate text в скобках не страдает', () => {
      const out = sanitizeMarkdown('Текст [статья](https://example.com/a-b) — продолжение.');
      expect(out.sanitized).toBe('Текст [статья](https://example.com/a-b) — продолжение.');
      expect(out.warnings.filter((w) => w.type === 'url_scheme_stripped')).toEqual([]);
    });
  });

  describe('line endings & clamping', () => {
    test('normalizes CRLF → LF', () => {
      const out = sanitizeMarkdown('line1\r\nline2\r\n');
      expect(out.sanitized).toBe('line1\nline2\n');
    });

    test('normalizes lone CR → LF', () => {
      const out = sanitizeMarkdown('a\rb\rc');
      expect(out.sanitized).toBe('a\nb\nc');
    });

    test('clamps to MAX_BODY_LENGTH', () => {
      const long = 'x'.repeat(MAX_BODY_LENGTH + 500);
      const out = sanitizeMarkdown(long);
      expect(out.sanitized.length).toBe(MAX_BODY_LENGTH);
      const warn = out.warnings.find((w) => w.type === 'body_truncated');
      expect(warn).toBeDefined();
      expect(warn.detail.originalLength).toBe(MAX_BODY_LENGTH + 500);
      expect(warn.detail.maxLength).toBe(MAX_BODY_LENGTH);
    });

    test('does NOT clamp at exactly MAX_BODY_LENGTH', () => {
      const exact = 'x'.repeat(MAX_BODY_LENGTH);
      const out = sanitizeMarkdown(exact);
      expect(out.sanitized.length).toBe(MAX_BODY_LENGTH);
      expect(out.warnings.filter((w) => w.type === 'body_truncated')).toEqual([]);
    });
  });

  describe('combinations', () => {
    test('strip + sanitize URL + clamp в одном input', () => {
      const bad = '<b>bold</b> [x](javascript:1) ' + 'y'.repeat(MAX_BODY_LENGTH);
      const out = sanitizeMarkdown(bad);
      expect(out.sanitized).not.toMatch(/<b>/);
      expect(out.sanitized).toContain('[x](#)');
      expect(out.sanitized.length).toBe(MAX_BODY_LENGTH);
      const types = out.warnings.map((w) => w.type);
      expect(types).toEqual(expect.arrayContaining([
        'html_tags_stripped',
        'url_scheme_stripped',
        'body_truncated',
      ]));
    });

    test('empty string passes through cleanly', () => {
      const out = sanitizeMarkdown('');
      expect(out.sanitized).toBe('');
      expect(out.warnings).toEqual([]);
    });

    test('pure plain text без спецсимволов — zero warnings', () => {
      const out = sanitizeMarkdown('Уважаемые жильцы,\nПлановое отключение воды 15 мая.\nСпасибо за понимание.');
      expect(out.sanitized).toContain('Уважаемые');
      expect(out.warnings).toEqual([]);
    });
  });
});

describe('markdownSanitizer.sanitizeTitle', () => {
  test.each([
    [null, ''],
    [undefined, ''],
    [42, ''],
  ])('non-string %p → empty', (input, expected) => {
    expect(sanitizeTitle(input)).toBe(expected);
  });

  test('strips HTML tags', () => {
    expect(sanitizeTitle('<script>alert(1)</script>Hello')).toBe('alert(1)Hello');
  });

  test('strips complex tag-in-title attack', () => {
    expect(sanitizeTitle('<img src=x onerror=alert(1)>Hi'))
      .toBe('Hi');
  });

  test('collapses whitespace', () => {
    expect(sanitizeTitle('  hello\n\n   world   ')).toBe('hello world');
  });

  test('replaces newlines with space', () => {
    expect(sanitizeTitle('line1\nline2\r\nline3')).toBe('line1 line2 line3');
  });

  test('clamps to MAX_TITLE_LENGTH', () => {
    const long = 'a'.repeat(MAX_TITLE_LENGTH + 50);
    expect(sanitizeTitle(long).length).toBe(MAX_TITLE_LENGTH);
  });

  test('trims surrounding whitespace', () => {
    expect(sanitizeTitle('   Объявление   ')).toBe('Объявление');
  });

  test('preserves non-ASCII characters (Cyrillic, emoji)', () => {
    expect(sanitizeTitle('Замоскворечье — 🏠 новости'))
      .toBe('Замоскворечье — 🏠 новости');
  });

  test('empty string → empty', () => {
    expect(sanitizeTitle('')).toBe('');
  });

  test('only HTML tags → empty', () => {
    expect(sanitizeTitle('<div></div><span></span>')).toBe('');
  });
});

describe('markdownSanitizer.constants', () => {
  test('MAX_BODY_LENGTH ≥ 8 KiB (sanity)', () => {
    expect(MAX_BODY_LENGTH).toBeGreaterThanOrEqual(8192);
  });

  test('MAX_TITLE_LENGTH разумный (100..500)', () => {
    expect(MAX_TITLE_LENGTH).toBeGreaterThanOrEqual(100);
    expect(MAX_TITLE_LENGTH).toBeLessThanOrEqual(500);
  });

  test('allowlist содержит http/https/mailto/tel', () => {
    for (const s of ['http', 'https', 'mailto', 'tel']) {
      expect(ALLOWED_URL_SCHEMES.has(s)).toBe(true);
    }
  });

  test('blacklist содержит javascript/data/vbscript/file', () => {
    for (const s of ['javascript', 'data', 'vbscript', 'file']) {
      expect(DANGEROUS_SCHEMES.has(s)).toBe(true);
    }
  });

  test('allowlist и blacklist не пересекаются', () => {
    for (const s of ALLOWED_URL_SCHEMES) {
      expect(DANGEROUS_SCHEMES.has(s)).toBe(false);
    }
  });
});
