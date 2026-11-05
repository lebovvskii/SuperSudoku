import shell from './game-shell.html?raw';
export async function GET() {
  return new Response(shell, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
  } });
}
