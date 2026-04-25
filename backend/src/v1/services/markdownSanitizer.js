'use strict';

// platform-v1 markdown sanitizer — Spec: content-spec.md §7 AC 7.1.
// Фаза: 5 (Content + Notifications).
//
// Цель: снижение XSS-поверхности на резидентских UI, которые рендерят
// announcements.body_md / documents.body_md в HTML.  Frontend использует
// markdown-parser (remark/markdown-it), который САМ эскейпит plain text, но
// parser НЕ защищает от:
//   1. Raw `<script>`, `<img onerror=...>`, `<iframe>` в теле — многие
//      парсеры пропускают их как HTML-passthrough.
//   2. `[text](javascript:alert(1))` — markdown-it и remark превращают это
//      в `<a href="javascript:...">` без валидации scheme'ы.
//
// Почему НЕ используем sanitize-html / DOMPurify:
//   • sanitize-html — 500KB+ deps, пригоден для HTML-output, не markdown-input.
//   • DOMPurify — требует jsdom в Node, heavy.
//   • Наш input — markdown-текст, не HTML.  Мы не парсим разметку,
//     только вырезаем raw HTML-теги + валидируем scheme в [text](url).
//
// Политика:
//   1. Strip ВСЕ HTML-теги (`<...>` → пусто).  Markdown имеет штатные
//      средства форматирования (bold/italic/links/lists) и raw HTML
//      здесь не нужен.  Если понадобится — будет отдельный policy-level
//      feature flag.
//   2. Strip HTML-комментарии (`<!-- ... -->`).
//   3. Валидация URL-scheme'ов в markdown-links / images:
//        allowlist: http, https, mailto, tel, относительные (без scheme).
//        всё остальное (javascript, data, vbscript, file, jar, ...) → `#`.
//   4. Normalize CRLF/CR → LF.
//   5. Clamp тела до MAX_BODY_LENGTH (32 KiB) — защита от памяти и
//      от отправки гигантского payload'а в notifications_outbox.
//
// Output sanitizeMarkdown():
//   { sanitized: string, warnings: [{ type, detail }] }
// warnings — для admin UI и audit_log; caller решает, логировать их или нет.

const MAX_BODY_LENGTH = 32 * 1024; // 32 KiB
const MAX_TITLE_LENGTH = 200;

// Scheme allowlist (lowercase, case-insensitive проверка).
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
// Blacklist — для telemetry (какие схемы реально пришли); reject происходит
// по allowlist.
const DANGEROUS_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'jar']);

// HTML-теги.  `[\s\S]` не нужен — теги не бывают multi-line в разумном
// корпусе; однако атакер может вставить `<img\nsrc=x\nonerror=alert(1)>` —
// поэтому используем [\s\S] и non-greedy.
const HTML_TAG_RE = /<\/?[a-zA-Z][\s\S]*?>/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// Markdown inline link / image.  Reference-style (`[text][id]`) не
// поддерживаем — в наших input'ах он не используется.  Если появится,
// reference-парсер просто не превратит его в link, т.е. уязвимости нет.
//
// Balanced-paren поддержка 1 уровня: `javascript:alert(1)` содержит `(1)`,
// поэтому `[x](javascript:alert(1))` требует nested-paren в URL-group.
// Deeper nesting (`(a(b(c)))`) НЕ поддерживается — для scheme-detection
// достаточно первого уровня.
//
// Тонкость: базовый `[^()]*` исключает ОБЕ скобки, иначе open-`(` будет
// жадно съеден и `(inner)` группа не сработает.
const MD_LINK_RE = /(!?)\[([^\]]*)\]\(([^()]*(?:\([^)]*\)[^()]*)*)\)/g;

// SEC [AUDIT-XSS]: декодируем ведущие HTML-entities + numeric-references перед
// scheme-detection.  Атакер может закодировать `j` как `&#x6A;` или `&#106;`,
// чтобы обойти простой `^[a-zA-Z]` regex — markdown-renderer'у потом отдаём
// `&#x6A;avascript:`, браузер при HTML-attribute-decode превращает в
// `javascript:` → XSS.  Декодируем только ведущие entity, чтобы остальная
// часть URL'а не была затронута (URL-encoding в path легитимен).
function decodeLeadingEntity(s) {
  // &#NN; (десятичные) и &#xNN; (шестнадцатеричные) — повторно, потому что
  // могут быть закодированы по нескольку штук подряд: `&#x6A;&#x61;...`.
  let prev;
  let cur = s;
  let safety = 0;
  do {
    prev = cur;
    cur = cur.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); }
      catch { return ''; }
    });
    cur = cur.replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); }
      catch { return ''; }
    });
    // Named entities: &lt; &gt; &quot; — вряд ли в начале URL'а, но дёшево.
    cur = cur.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, name) => {
      const named = { lt: '<', gt: '>', quot: '"', amp: '&', apos: "'" };
      return Object.prototype.hasOwnProperty.call(named, name) ? named[name] : m;
    });
    safety += 1;
  } while (cur !== prev && safety < 8);
  return cur;
}

function extractScheme(url) {
  // SEC [AUDIT-XSS]: trim'аем whitespace + декодируем ведущие entity ПЕРЕД
  // regex'ом.  `[click]( javascript:alert(1))` — пробел заставляет
  // `^[a-zA-Z]` не сработать, но CommonMark парсер тримит destination
  // → `<a href="javascript:alert(1)">` → XSS.  Решение: любая нормализация,
  // которую сделает рендерер, должна быть применена и здесь.
  // \s в JS regex покрывает пробел, таб, NL, CR, FF, VT, NBSP ( ) и др.
  const trimmed = String(url).replace(/^[\s ]+/, '');
  const decoded = decodeLeadingEntity(trimmed);
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(decoded);
  return m ? m[1].toLowerCase() : null;
}

function sanitizeUrl(url, warnings) {
  const scheme = extractScheme(url);
  if (scheme === null) {
    // SEC [AUDIT-XSS]: даже relative/anchor URL — strip leading whitespace,
    // чтобы рендерер не получил ведущий пробел/таб (они нормализуются
    // парсером, но руководствуясь принципом «вход === выход» отдаём
    // канонический вид).  Нормализация безопасна: leading whitespace в
    // CommonMark inline-link'е и так удаляется.
    const stripped = String(url).replace(/^[\s ]+/, '');
    return stripped;
  }
  if (ALLOWED_URL_SCHEMES.has(scheme)) {
    // Если scheme прошёл — отдаём trim'нутую версию (см. выше): renderer
    // тоже её trim'нет, чтобы не было расхождения.
    return String(url).replace(/^[\s ]+/, '');
  }
  warnings.push({
    type: 'url_scheme_stripped',
    detail: { scheme, dangerous: DANGEROUS_SCHEMES.has(scheme) },
  });
  return '#';
}

/**
 * sanitizeMarkdown — основная функция.
 * input: строка markdown (или null/undefined — обрабатываем как '').
 * return: { sanitized, warnings }.
 */
function sanitizeMarkdown(input) {
  const warnings = [];
  if (typeof input !== 'string') {
    return { sanitized: '', warnings };
  }

  // 1. Normalize line endings.
  let text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Strip HTML-комментарии ПЕРЕД тегами — иначе `<!-- <script> -->`
  //    удалит только комментарий, оставив <script>.
  const commentMatches = text.match(HTML_COMMENT_RE);
  if (commentMatches && commentMatches.length > 0) {
    warnings.push({
      type: 'html_comments_stripped',
      detail: { count: commentMatches.length },
    });
    text = text.replace(HTML_COMMENT_RE, '');
  }

  // 3. Strip HTML-теги.  Повторяем loop до тех пор, пока не перестанут
  //    находиться теги — защита от `<<script>script>` трюка, когда после
  //    первого прохода остаётся валидный тег.
  let iteration = 0;
  let tagsStripped = 0;
  while (iteration < 3) {
    const matches = text.match(HTML_TAG_RE);
    if (!matches || matches.length === 0) break;
    tagsStripped += matches.length;
    text = text.replace(HTML_TAG_RE, '');
    iteration += 1;
  }
  if (tagsStripped > 0) {
    warnings.push({ type: 'html_tags_stripped', detail: { count: tagsStripped } });
  }

  // 4. Sanitize URL schemes в markdown-links / images.
  text = text.replace(MD_LINK_RE, (_match, bang, textPart, url) => {
    const safe = sanitizeUrl(url, warnings);
    return `${bang}[${textPart}](${safe})`;
  });

  // 5. Clamp длину.
  if (text.length > MAX_BODY_LENGTH) {
    warnings.push({
      type: 'body_truncated',
      detail: { originalLength: text.length, maxLength: MAX_BODY_LENGTH },
    });
    text = text.slice(0, MAX_BODY_LENGTH);
  }

  return { sanitized: text, warnings };
}

/**
 * sanitizeTitle — одноусловный title field: strip HTML, свернуть whitespace,
 * clamp до MAX_TITLE_LENGTH.  Возвращает только строку (без warnings —
 * title short и визуально проверяется админом).
 */
function sanitizeTitle(input) {
  if (typeof input !== 'string') return '';
  let t = input
    .replace(/\r\n|\r/g, ' ')
    .replace(/\n/g, ' ');

  // Несколько проходов strip — как в sanitizeMarkdown.
  let iteration = 0;
  while (iteration < 3) {
    const matches = t.match(HTML_TAG_RE);
    if (!matches || matches.length === 0) break;
    t = t.replace(HTML_TAG_RE, '');
    iteration += 1;
  }
  t = t.replace(HTML_COMMENT_RE, '').replace(/\s+/g, ' ').trim();
  if (t.length > MAX_TITLE_LENGTH) t = t.slice(0, MAX_TITLE_LENGTH);
  return t;
}

module.exports = {
  sanitizeMarkdown,
  sanitizeTitle,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  ALLOWED_URL_SCHEMES,
  DANGEROUS_SCHEMES,
};
