import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft } from '../src/core/youtube.js';

const base = '2026-11-10T00:00:00Z';
const after = (d) => new Date(Date.parse(base) + d * 86400000);

test('daysLeft：つないで2日後は5', () => assert.equal(daysLeft(base, after(2)), 5));
test('daysLeft：つないだ直後は7', () => assert.equal(daysLeft(base, after(0)), 7));
test('daysLeft：8日後は0（負にならない）', () => assert.equal(daysLeft(base, after(8)), 0));
test('daysLeft：ちょうど7日後は0', () => assert.equal(daysLeft(base, after(7)), 0));
test('daysLeft：半日過ぎたら切り上げて残りを数える', () => assert.equal(daysLeft(base, after(2.5)), 5));
test('daysLeft：日時が読めないときは0', () => assert.equal(daysLeft('x', after(1)), 0));
