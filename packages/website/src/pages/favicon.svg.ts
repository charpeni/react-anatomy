import icon from '@react-anatomy/brand/svg/icon-32.svg?raw';

export async function GET() {
  return new Response(icon, { headers: { 'Content-Type': 'image/svg+xml' } });
}
