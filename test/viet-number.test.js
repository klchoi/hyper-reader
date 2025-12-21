import assert from 'node:assert/strict';
import test from 'node:test';
import parseVietnameseNumber from '../viet-number.js';

test('parseVietnameseNumber - basic units', () => {
  assert.equal(parseVietnameseNumber('một'), 1);
  assert.equal(parseVietnameseNumber('hai'), 2);
  assert.equal(parseVietnameseNumber('chín'), 9);
});

test('parseVietnameseNumber - synonyms', () => {
  assert.equal(parseVietnameseNumber('mốt'), null);
  assert.equal(parseVietnameseNumber('tư'), null);
  assert.equal(parseVietnameseNumber('lăm'), null);
});

test('parseVietnameseNumber - tens', () => {
  assert.equal(parseVietnameseNumber('mười'), 10);
  assert.equal(parseVietnameseNumber('hai mươi'), 20);
  assert.equal(parseVietnameseNumber('hai mươi mốt'), 21);
  assert.equal(parseVietnameseNumber('ba mươi lăm'), 35);
  assert.equal(parseVietnameseNumber('bốn mươi tư'), 44);
});

test('parseVietnameseNumber - hundreds', () => {
  assert.equal(parseVietnameseNumber('một trăm'), 100);
  assert.equal(parseVietnameseNumber('một trăm linh năm'), 105);
  assert.equal(parseVietnameseNumber('hai trăm ba mươi tư'), 234);
});

test('parseVietnameseNumber - thousands', () => {
  assert.equal(parseVietnameseNumber('một nghìn'), 1000);
  assert.equal(parseVietnameseNumber('hai nghìn không trăm linh năm'), 2005);
  assert.equal(parseVietnameseNumber('ba nghìn bốn trăm năm mươi sáu'), 3456);
});

test('parseVietnameseNumber - edge and invalid cases', () => {
  assert.equal(parseVietnameseNumber(''), null);
  assert.equal(parseVietnameseNumber('abc'), null);
  assert.equal(parseVietnameseNumber('mười abc'), null);
  assert.equal(parseVietnameseNumber('ngàn'), 1000); // implicit one
  assert.equal(parseVietnameseNumber('trăm'), 100);  // implicit one
});
