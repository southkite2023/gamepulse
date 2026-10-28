/** Remote endpoints must use TLS; HTTP is reserved for loopback development. */
export function relayUrl(path) {
  const base = new URL(process.env.GAMEPULSE_RELAY_URL ?? 'http://127.0.0.1:8787');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) {
    throw new Error('Relay URL must be an HTTPS origin or loopback HTTP origin');
  }
  return new URL(path, base);
}
