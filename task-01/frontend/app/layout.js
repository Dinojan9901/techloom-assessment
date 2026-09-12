import './globals.css';
import { Nav } from '../components/nav.js';

export const metadata = {
  title: 'Techloom POS — Orders & Inventory',
  description:
    'Concurrency-safe point-of-sale: stock reservations, mock payments and a full order lifecycle.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <span className="brand">
            <span className="brand-dot" />
            Techloom POS
          </span>
          <Nav />
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            Task 01 · Order &amp; Inventory
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}
