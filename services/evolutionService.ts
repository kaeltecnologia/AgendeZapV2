
import { db } from './mockDb';

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

  /**
   * Obtém o nome da instância baseado EXCLUSIVAMENTE no slug da barbearia.
   * Adiciona o prefixo 'agz_' para evitar conflitos.
   */
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
        body: JSON.stringify({ count, page: 1 })
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

  async createAndFetchQr(instanceName: string): Promise<any> {
    if (!instanceName) return { status: 'error', message: 'Nome da instância inválido.' };
    
    try {
      // 1. Tentar verificar se já existe para evitar erro 409
      const statusResponse = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, { 
        method: 'GET', 
        headers 
      });
      
      let instanceExists = false;
      if (statusResponse.ok) {
        const instances = await statusResponse.json();
        instanceExists = Array.isArray(instances) ? instances.some((i: any) => i.instanceName === instanceName) : false;
      }

      if (!instanceExists) {
        // 2. Criar a instância apenas se não existir
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
        if (!createRes.ok && createRes.status !== 409) {
          const errData = await createRes.json();
          throw new Error(errData.message || "Erro ao criar instância no servidor Evolution.");
        }
      }
      
      await this.sleep(1500);

      // 3. Conectar/Pegar QR
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

      return { 
        status: 'success', 
        qrcode: qr,
        message: 'QR Code Gerado.'
      };
      
    } catch (e: any) {
      return { status: 'error', message: e.message || 'Erro inesperado na Evolution API.' };
    }
  },

  async setWebhook(instanceName: string): Promise<boolean> {
    if (!instanceName) return false;
    try {
      const response = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: "https://agendezap-api-handler.xzftjp.easypanel.host/webhook",
          enabled: true,
          webhook_by_events: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        })
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }
};
