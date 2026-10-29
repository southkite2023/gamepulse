import { randomBytes } from 'node:crypto';

/** One-computer development pairing. No public multi-tenant registration yet. */
export class Pairing {
  #pending; #openId; #now; #lastChange = 0;
  constructor({ now = Date.now } = {}) { this.#now = now; }
  begin() {
    this.#pending = { scene: randomBytes(24).toString('hex'), expiresAt: this.#now() + 300_000 };
    return { ...this.#pending };
  }
  get openId() { return this.#openId; }
  unbind() { this.#pending = undefined; this.#openId = undefined; this.#lastChange = this.#now(); }
  apply(event) {
    const createdAt = Number(event.CreateTime) * 1000;
    if (!Number.isSafeInteger(createdAt) || Math.abs(this.#now() - createdAt) > 300_000 || createdAt < this.#lastChange) return false;
    if (event.Event === 'unsubscribe' && event.FromUserName === this.#openId) { this.#openId = undefined; this.#lastChange = createdAt; return true; }
    const scene = event.Event === 'subscribe' && event.EventKey?.startsWith('qrscene_')
      ? event.EventKey.slice(8) : event.Event === 'SCAN' ? event.EventKey : undefined;
    if (!scene || !this.#pending || this.#pending.expiresAt <= this.#now() || scene !== this.#pending.scene) return false;
    this.#openId = event.FromUserName; this.#pending = undefined; this.#lastChange = createdAt;
    return true;
  }
}
