import assert from 'node:assert/strict';
import test from 'node:test';

import { invalidatePalette, paletteFor } from '../src/app/skins';

interface GlobalStubs {
  document?: unknown;
  getComputedStyle?: unknown;
}

const globals = globalThis as unknown as GlobalStubs;

function stubDom(bodyHasSkin: boolean, variableValue: string): void {
  globals.document = { body: { classList: { contains: () => bodyHasSkin } } };
  globals.getComputedStyle = () => ({ getPropertyValue: () => variableValue });
}

function clearDom(): void {
  delete globals.document;
  delete globals.getComputedStyle;
}

test('body 没有皮肤 class 时 paletteFor 抛错，不画错配色', () => {
  invalidatePalette();
  stubDom(false, '#ffffff');
  try {
    assert.throws(() => paletteFor(), /skin-voyage/);
  } finally {
    clearDom();
    invalidatePalette();
  }
});

test('styles.css 缺变量时 paletteFor 抛错并列出缺失变量', () => {
  invalidatePalette();
  stubDom(true, '');
  try {
    assert.throws(() => paletteFor(), /缺少变量/);
    assert.throws(() => paletteFor(), /--bg/);
  } finally {
    clearDom();
    invalidatePalette();
  }
});

test('变量齐全时 paletteFor 读回全部 token 并带上事件透明度', () => {
  invalidatePalette();
  stubDom(true, '#abcdef');
  try {
    const palette = paletteFor();
    assert.equal(palette.paper, '#abcdef');
    assert.equal(palette.accent, '#abcdef');
    assert.equal(palette.eventAlpha, 0.1);
    assert.equal(palette.eventAlphaDim, 0.03);
  } finally {
    clearDom();
    invalidatePalette();
  }
});
