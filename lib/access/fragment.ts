export function accessLink(origin: string, path: string, secret: string) {
  const url = new URL(path, origin);
  url.searchParams.delete('code');
  url.hash = `code=${encodeURIComponent(secret)}`;
  return url.toString();
}

export function consumeAccessFragment(href: string) {
  const url = new URL(href);
  const fromQuery = url.searchParams.get('code');
  const match = url.hash.match(/(?:^#|&)code=([^&]*)/);
  const secret = match ? decodeURIComponent(match[1]) : null;
  url.hash = '';
  url.searchParams.delete('code');
  return { secret: fromQuery && !secret ? null : secret, href: url.toString() };
}
