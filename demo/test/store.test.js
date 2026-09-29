import test from 'node:test';
import assert from 'node:assert/strict';
import { findProduct, subtotalCents } from '../src/store.js';

test('finds a product by SKU', () => {
  assert.equal(findProduct('MUG-01')?.name, 'Ceramic mug');
});

test('calculates a cart subtotal in cents', () => {
  assert.equal(subtotalCents([{ sku: 'MUG-01', quantity: 2 }, { sku: 'BAG-02', quantity: 1 }]), 6000);
});

test('rejects out-of-stock quantities', () => {
  assert.throws(() => subtotalCents([{ sku: 'PIN-03', quantity: 1 }]), /Invalid quantity/);
});
