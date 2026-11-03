import Link from 'next/link';
import './style.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" data-check="home-link">
            Review
          </Link>
          <Link href="/details" data-check="details-link">
            Details
          </Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
