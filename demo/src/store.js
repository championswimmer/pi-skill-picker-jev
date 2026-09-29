import products from '../data/products.json' with { type: 'json' };

export function findProduct(sku, catalog = products) {
  return catalog.find((product) => product.sku === sku);
}

export function subtotalCents(lines, catalog = products) {
  return lines.reduce((total, { sku, quantity }) => {
    const product = findProduct(sku, catalog);
    if (!product) throw new Error(`Unknown SKU: ${sku}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) {
      throw new Error(`Invalid quantity for ${sku}`);
    }
    return total + product.priceCents * quantity;
  }, 0);
}
