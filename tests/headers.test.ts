import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface HeaderRule {
  pattern: string;
  headers: Map<string, string>;
  detached: Set<string>;
}

function parseHeadersFile(path: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: new Map(), detached: new Set() };
      rules.push(current);
      continue;
    }
    assert.ok(current, `header 行缺少规则：${line}`);
    const trimmed = line.trim();
    if (trimmed.startsWith('!')) {
      current.detached.add(trimmed.slice(1).trim().toLowerCase());
      continue;
    }
    const separator = line.indexOf(':');
    assert.ok(separator > 0, `无效的 header 行：${line}`);
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    current.headers.set(name, value);
  }
  return rules;
}

function ruleFor(rules: HeaderRule[], pattern: string): HeaderRule {
  const rule = rules.find((item) => item.pattern === pattern);
  assert.ok(rule, `_headers 缺少规则：${pattern}`);
  return rule;
}

function cspDirectives(value: string | undefined): Map<string, string[]> {
  assert.ok(value, '缺少 Content-Security-Policy');
  const directives = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) directives.set(tokens[0], tokens.slice(1));
  }
  return directives;
}

const rules = parseHeadersFile('public/_headers');

test('所有响应都带基础安全头，HSTS 不启用 preload 与子域', () => {
  const headers = ruleFor(rules, '/*').headers;
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('strict-transport-security'), 'max-age=31536000');
  assert.doesNotMatch(headers.get('strict-transport-security') ?? '', /preload|includeSubDomains/i);
});

test('CSP 只放行同源资源，脚本不允许内联，样式允许内联属性', () => {
  const csp = cspDirectives(ruleFor(rules, '/*').headers.get('content-security-policy'));

  assert.deepEqual(csp.get('default-src'), ["'self'"]);
  assert.deepEqual(csp.get('script-src'), ["'self'"]);
  assert.deepEqual(csp.get('connect-src'), ["'self'"]);
  assert.deepEqual(csp.get('font-src'), ["'self'"]);
  assert.deepEqual(csp.get('object-src'), ["'none'"]);
  assert.deepEqual(csp.get('base-uri'), ["'self'"]);
  assert.deepEqual(csp.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(csp.get('form-action'), ["'self'"]);

  const style = csp.get('style-src') ?? [];
  assert.ok(style.includes("'self'"), "style-src 必须包含 'self'");
  assert.ok(style.includes("'unsafe-inline'"), 'style-src 必须允许内联 style 属性');
  assert.ok(!style.includes("'unsafe-eval'"), 'style-src 不应放行 eval');

  const image = csp.get('img-src') ?? [];
  assert.ok(image.includes("'self'"), "img-src 必须包含 'self'");
  assert.ok(image.includes('data:'), 'img-src 必须包含 data:');
  assert.ok(image.includes('blob:'), 'img-src 必须包含 blob:');
});

test('缓存策略区分带 hash 资源、固定文件名数据与 HTML 入口', () => {
  assert.equal(ruleFor(rules, '/assets/*').headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(ruleFor(rules, '/data/*').headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  for (const pattern of ['/', '/index.html']) {
    const rule = ruleFor(rules, pattern);
    assert.ok(rule.detached.has('cache-control'), `${pattern} 必须先删除默认 Cache-Control`);
    assert.equal(rule.headers.get('cache-control'), 'no-cache');
  }
});

test('404 页不包含内联脚本，重定向脚本可由 script-src self 加载', () => {
  const html = readFileSync('public/404.html', 'utf8');
  assert.match(html, /<script src="\/404\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  const script = readFileSync('public/404.js', 'utf8');
  assert.match(script, /location\.replace/);
});
