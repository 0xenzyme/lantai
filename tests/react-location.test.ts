import assert from 'node:assert/strict';
import test from 'node:test';
import { isTimelinePage, type BrowserLocation } from '../src/react/location';

function route(pathname: string, hash = ''): BrowserLocation {
  return { pathname, search: '', hash };
}

test('React 年表路由判定覆盖正式与兼容入口', () => {
  assert.equal(isTimelinePage(route('/')), false);
  assert.equal(isTimelinePage(route('/', '#tang')), true);
  assert.equal(isTimelinePage(route('/timeline')), true);
  assert.equal(isTimelinePage(route('/timeline.html')), true);
  assert.equal(isTimelinePage(route('/legacy.html')), true);
  assert.equal(isTimelinePage(route('/index.html')), true);
  assert.equal(isTimelinePage(route('/nested/index.html')), true);
  assert.equal(isTimelinePage(route('/people/li-bai')), false);
});
