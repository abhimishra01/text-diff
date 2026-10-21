import type { APIRoute } from 'astro';
import site from '../site.config.ts';
// To swap: put your own file at public/favicon.svg and delete this file.
export const GET: APIRoute = () => {
  const initial = site.name.trim().charAt(0).toUpperCase().replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${site.brand}"/><text x="32" y="45" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Arial,sans-serif" font-size="38" font-weight="800" fill="#fff">${initial}</text></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
};
