const API = 'https://api.weixin.qq.com';
const TOKEN_ERRORS = new Set([40001, 40014, 42001]);

export class WeChatError extends Error {
  constructor(code) { super(`WeChat API rejected request (${code})`); this.code = code; }
}

/** Server-side only. Never serialize this client or log API request URLs. */
export class WeChatClient {
  #appId; #appSecret; #fetch; #now; #cached; #pending;
  constructor({ appId, appSecret, fetchImpl = fetch, now = Date.now }) {
    if (!appId || !appSecret) throw new Error('WECHAT_APP_ID and WECHAT_APP_SECRET are required');
    this.#appId = appId; this.#appSecret = appSecret; this.#fetch = fetchImpl; this.#now = now;
  }
  async #json(url, options = {}) {
    // Replace transport errors: fetch errors can contain URLs with credentials.
    let response;
    try { response = await this.#fetch(url, { ...options, signal: AbortSignal.timeout(8000) }); }
    catch { throw new Error('WeChat transport failed; delivery may be unknown'); }
    if (!response.ok) throw new Error(`WeChat HTTP failure (${response.status})`);
    let body;
    try { body = await response.json(); } catch { throw new Error('Invalid WeChat response'); }
    if (body.errcode) throw new WeChatError(body.errcode);
    return body;
  }
  async #token() {
    if (this.#cached && this.#cached.expires > this.#now()) return this.#cached.value;
    if (this.#pending) return this.#pending;
    this.#pending = (async () => {
      const url = new URL('/cgi-bin/token', API);
      url.search = new URLSearchParams({ grant_type: 'client_credential', appid: this.#appId, secret: this.#appSecret });
      const body = await this.#json(url);
      if (typeof body.access_token !== 'string' || !Number.isFinite(body.expires_in) || body.expires_in <= 120) {
        throw new Error('Invalid WeChat token response');
      }
      this.#cached = { value: body.access_token, expires: this.#now() + (body.expires_in - 120) * 1000 };
      return body.access_token;
    })();
    try { return await this.#pending; } finally { this.#pending = undefined; }
  }
  async #post(path, payload, retry = true) {
    const token = await this.#token();
    const url = new URL(path, API); url.searchParams.set('access_token', token);
    try { return await this.#json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
    catch (error) {
      // Only an explicit invalid-token response is retried. A timeout may have delivered.
      if (retry && error instanceof WeChatError && TOKEN_ERRORS.has(error.code)) {
        if (this.#cached?.value === token) this.#cached = undefined;
        return this.#post(path, payload, false);
      }
      throw error;
    }
  }
  async createPairingQr(scene, expiresIn = 300) {
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(scene)) throw new TypeError('Invalid pairing scene');
    const body = await this.#post('/cgi-bin/qrcode/create', {
      expire_seconds: expiresIn, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: scene } }
    });
    if (typeof body.ticket !== 'string' || !body.ticket) throw new Error('Invalid WeChat QR response');
    return { imageUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(body.ticket)}`, expiresIn };
  }
  async sendTemplate({ openId, templateId, data }) {
    if (typeof openId !== 'string' || !openId || typeof templateId !== 'string' || !templateId ||
        !data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Invalid template configuration');
    const body = await this.#post('/cgi-bin/message/template/send', { touser: openId, template_id: templateId, data });
    if (body.errcode !== 0 || body.msgid === undefined) throw new Error('Invalid WeChat send response');
    return { messageId: body.msgid, status: 'accepted' };
  }
}
