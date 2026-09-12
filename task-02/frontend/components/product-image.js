'use client';

/**
 * Product artwork, generated from the SKU.
 *
 * A catalogue this size would normally carry photography. Rather than lean on a
 * third-party image host that can rate-limit or disappear and leave the
 * storefront full of broken tiles, each product gets a deterministic gradient
 * derived from its SKU — stable across reloads, and no network request.
 */
function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) % 360;
  }
  return result;
}

export function ProductImage({ sku, name, size = 'tile' }) {
  const hue = hash(sku ?? name ?? 'product');
  const initials = (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div
      className={`product-image product-image--${size}`}
      style={{
        background: `linear-gradient(135deg,
          hsl(${hue} 62% 58%) 0%,
          hsl(${(hue + 38) % 360} 58% 46%) 100%)`,
      }}
      role="img"
      aria-label={name}
    >
      <span>{initials}</span>
    </div>
  );
}
