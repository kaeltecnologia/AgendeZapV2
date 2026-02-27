
export const EVOLUTION_API_URL = "https://evolution-api-agendezap-evolution-api.xzftjp.easypanel.host";
export const EVOLUTION_API_KEY = "429683C4C977415CAAFCCE10F7D57E11";

const headers = {
  "Content-Type": "application/json",
  "apikey": EVOLUTION_API_KEY
};

export interface SendMessageResponse {
  success: boolean;
  error?: string;
}

export const evolutionService = {
  async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  getInstanceName(slug: string) {
    if (!slug) return '';
    const cleanSlug = slug.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, '')
      .trim();
    return `agz_${cleanSlug}`;
  },

  async checkStatus(instanceName: string): Promise<'open' | 'close' | 'connecting'> {
    if (!instanceName) return 'close';
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
        method: 'GET',
        headers
      });
      if (!response.ok) return 'close';
      const data = await response.json();
      const state = (data.instance?.state || data.state || "").toUpperCase();
      if (['OPEN', 'CONNECTED', 'ONLINE'].includes(state)) return 'open';
      if (['CONNECTING', 'PAIRING', 'CONNECTING_SESSION'].includes(state)) return 'connecting';
      return 'close';
    } catch (e) {
      return 'close';
    }
  },

  async fetchRecentMessages(instanceName: string, count: number = 20) {
    if (!instanceName) return null;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          where: {},
          limit: count
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.messages?.records || data.records || data;
    } catch (error) {
      return null;
    }
  },

  async sendToWhatsApp(instanceName: string, to: string, text: string): Promise<SendMessageResponse> {
    const cleanNumber = to.replace(/\D/g, '');
    if (!instanceName) return { success: false, error: "Instância não definida" };
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: cleanNumber,
          text: text,
          linkPreview: false
        })
      });
      if (response.ok) return { success: true };
      const errData = await response.json();
      return { success: false, error: errData.message || "Falha ao enviar" };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  async sendMessage(instanceName: string, recipient: string, text: string): Promise<SendMessageResponse> {
    return this.sendToWhatsApp(instanceName, recipient, text);
  },

  async logoutInstance(instanceName: string): Promise<boolean> {
    if (!instanceName) return false;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  },

  async deleteInstance(instanceName: string): Promise<boolean> {
    if (!instanceName) return false;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  },

  // Checks if an instance already exists in Evolution API.
  // Handles both v1 ({ instanceName }) and v2 ({ instance: { instanceName } }) response formats.
  async instanceExists(instanceName: string): Promise<boolean> {
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
        method: 'GET',
        headers
      });
      if (!res.ok) return false;
      const data = await res.json();
      const list: any[] = Array.isArray(data) ? data : [];
      return list.some(
        (i: any) =>
          i.instanceName === instanceName ||
          i.instance?.instanceName === instanceName ||
          i.name === instanceName
      );
    } catch {
      return false;
    }
  },

  // Restarts an existing (disconnected) instance so we can get a fresh QR code.
  async restartInstance(instanceName: string): Promise<boolean> {
    try {
      // Evolution API v2: PUT /instance/restart/{name}
      const res = await fetch(`${EVOLUTION_API_URL}/instance/restart/${instanceName}`, {
        method: 'PUT',
        headers
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Connects (or reconnects) to get a QR code.
  // Strategy:
  //   1. If instance already exists → restart it to clear old WA session → get QR
  //   2. If instance does not exist → create it → get QR
  //   3. If already open → return success immediately
  async createAndFetchQr(instanceName: string): Promise<any> {
    if (!instanceName) return { status: 'error', message: 'Nome da instância inválido.' };
    try {
      // ── Step 1: check current connection state first (fast path)
      const currentStatus = await this.checkStatus(instanceName);
      if (currentStatus === 'open') {
        return { status: 'success', qrcode: null, message: 'Conectado.' };
      }

      // ── Step 2: check existence
      const exists = await this.instanceExists(instanceName);

      if (exists) {
        // Instance exists but is disconnected → restart to get a fresh QR code
        await this.restartInstance(instanceName);
        await this.sleep(2000);
      } else {
        // Instance doesn't exist → create it
        const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            instanceName,
            token: EVOLUTION_API_KEY,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS"
          })
        });
        // 409 = already exists (race condition) — safe to continue
        if (!createRes.ok && createRes.status !== 409) {
          const errData = await createRes.json().catch(() => ({}));
          throw new Error(errData.message || "Erro ao criar instância no servidor Evolution.");
        }
        await this.sleep(1500);
      }

      // ── Step 3: request QR code / connection
      const connectResponse = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers
      });
      if (!connectResponse.ok) {
        throw new Error("Servidor Evolution não respondeu ao pedido de conexão.");
      }

      const data = await connectResponse.json();
      if (data.instance?.state === 'open' || data.state === 'open') {
        return { status: 'success', qrcode: null, message: 'Conectado.' };
      }

      const qr = data.base64 || data.code || null;
      if (!qr) {
        return { status: 'error', message: 'QR Code ainda não disponível. Tente novamente em alguns segundos.' };
      }

      return { status: 'success', qrcode: qr, message: 'QR Code Gerado.' };
    } catch (e: any) {
      return { status: 'error', message: e.message || 'Erro inesperado na Evolution API.' };
    }
  },

  // Enables the Edge Function webhook so Evolution API posts messages to it 24/7.
  async enableWebhook(instanceName: string, webhookUrl: string): Promise<boolean> {
    if (!instanceName || !webhookUrl) return false;
    const body = JSON.stringify({
      url: webhookUrl,
      enabled: true,
      webhook_by_events: false,
      webhook_base64: true,  // include audio base64 in payload
      events: ['MESSAGES_UPSERT', 'messages.upsert']
    });
    try {
      await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method: 'POST', headers, body });
    } catch { /* ignore */ }
    return true;
  },

  // NOTE: setWebhook intentionally calls disableWebhook — the external webhook server
  // must NEVER be re-registered. Frontend polling is the sole message processor.
  async setWebhook(instanceName: string): Promise<boolean> {
    return this.disableWebhook(instanceName);
  },

  // Disables the external webhook so only frontend polling processes messages.
  // Tries EVERY known Evolution API endpoint variant (v1, v2, forks) to guarantee
  // the webhook is cleared regardless of which API version is running.
  async disableWebhook(instanceName: string): Promise<boolean> {
    if (!instanceName) return false;

    // Use the Evolution API's own base URL as the noop webhook target.
    // Requests hit the same server, return a quick non-200 at /noop, and are
    // discarded — no external server ever receives or processes the message.
    const noopUrl = `${EVOLUTION_API_URL}/noop-disabled`;
    const body = JSON.stringify({
      url: noopUrl,
      enabled: false,
      webhook_by_events: false,
      events: []
    });

    const tries: Promise<any>[] = [
      // v1 / v2: POST set with enabled:false
      fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method: 'POST', headers, body }).catch(() => null),
      // Some forks: DELETE on /webhook/{name}
      fetch(`${EVOLUTION_API_URL}/webhook/${instanceName}`, { method: 'DELETE', headers }).catch(() => null),
      // Some forks: DELETE on /webhook/set/{name}
      fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, { method: 'DELETE', headers }).catch(() => null),
    ];

    await Promise.allSettled(tries);

    // Verify: read back the configured webhook and warn if still enabled
    try {
      const check = await fetch(`${EVOLUTION_API_URL}/webhook/find/${instanceName}`, { method: 'GET', headers });
      if (check.ok) {
        const cfg = await check.json().catch(() => ({}));
        const enabled = cfg?.webhook?.enabled ?? cfg?.enabled;
        const url: string = cfg?.webhook?.url ?? cfg?.url ?? '';
        if (enabled === true && url.includes('agendezap-api-handler')) {
          console.warn('[evolutionService] disableWebhook: webhook still enabled after attempts — Evolution API may be restoring it on reconnect.');
        }
      }
    } catch { /* ignore — just a verification step */ }

    return true;
  }
};