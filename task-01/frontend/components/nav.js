'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Register' },
  { href: '/products', label: 'Inventory' },
  { href: '/orders', label: 'Orders' },
];

export function Nav() {
  const pathname = usePathname();

  return (
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
  );
}
