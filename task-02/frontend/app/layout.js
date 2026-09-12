import './globals.css';
import { CartProvider } from '../components/cart-context.js';
import { Header } from '../components/header.js';

export const metadata = {
  title: 'Techloom Shop — Storefront & Checkout',
  description:
    'A storefront with search, stock reservations at checkout, mock payments, refunds and order history.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <CartProvider>
          <Header />
          {children}
        </CartProvider>
      </body>
    </html>
  );
}
