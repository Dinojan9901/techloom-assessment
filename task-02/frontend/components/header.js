'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useCart } from './cart-context.js';

const LINKS = [
  { href: '/', label: 'Shop' },
  { href: '/orders', label: 'My orders' },
];

export function Header() {
  const pathname = usePathname();
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-dot" />
        Techloom Shop
      </Link>

      <nav className="nav">
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            data-active={href === '/' ? pathname === '/' : pathname.startsWith(href)}
          >
            {label}
          </Link>
        ))}
      </nav>

      <Link className="btn btn-sm" href="/cart" style={{ marginLeft: 'auto' }}>
        Cart
        {count > 0 ? <span className="cart-count">{count}</span> : null}
      </Link>
    </header>
  );
}
