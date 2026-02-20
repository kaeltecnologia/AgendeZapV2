
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "./mockDb";
import { AppointmentStatus, BookingSource } from "../types";
import { sendProfessionalNotification } from "./notificationService";

export const processWhatsAppMessage = async (tenantId: string, phone: string, name: string, message: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const [professionals, services, tenants] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
    db.getAllTenants()
  ]);
  
  const tenant = tenants.find(t => t.id === tenantId);
  const shopName = tenant?.name || "Barbearia";
  const today = new Date();

  if (professionals.length === 0 || services.length === 0) {
    return { 
      replyText: `Olá! Sou o assistente da ${shopName}. No momento nosso catálogo está em manutenção, mas logo voltaremos ao normal!`, 
      intent: "CHAT",
      error: "O administrador precisa cadastrar barbeiros e serviços."
    };
  }

  const context = `
    IDENTIDADE: Você é o Atendente Digital da "${shopName}".
    OBJETIVO: Agendar horários de forma rápida e natural.
    
    CATÁLOGO:
    - Barbeiros: ${professionals.map(p => p.name).join(', ')}.
    - Serviços: ${services.map(s => `${s.name} (R$${s.price.toFixed(2)})`).join(', ')}.
    
    DATA ATUAL: ${today.toLocaleString('pt-BR')} (Hoje é ${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][today.getDay()]}).

    REGRAS:
    1. Nunca use listas numeradas.
    2. Se o cliente pedir agendamento, você deve identificar: O que ele quer (Serviço), com quem (Barbeiro) e quando (Data/Hora).
    3. Se faltar informação, peça educadamente.
    4. Ao confirmar, use o campo "appointmentDetails" no JSON de saída.
    5. Para o campo "dateTime", use sempre o formato ISO 8601 (Ex: 2024-05-20T14:30:00).
  `;

  try {
    const response = await ai.models.generateContent({
      // Use gemini-3-pro-preview for complex text tasks such as information extraction for booking
      model: "gemini-3-pro-preview",
      contents: message,
      config: {
        systemInstruction: context,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: { type: Type.STRING, description: "Texto que será enviado ao cliente no WhatsApp" },
            intent: { type: Type.STRING, enum: ["BOOKING", "CHAT"] },
            appointmentDetails: {
              type: Type.OBJECT,
              properties: {
                professionalName: { type: Type.STRING },
                serviceName: { type: Type.STRING },
                dateTime: { type: Type.STRING, description: "Data e hora no formato ISO" }
              }
            }
          },
          required: ["replyText", "intent"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");

    // Lógica de agendamento se os detalhes foram extraídos
    if (result.appointmentDetails?.dateTime) {
      const requestedDate = new Date(result.appointmentDetails.dateTime);
      
      if (!isNaN(requestedDate.getTime())) {
        const customer = await db.findOrCreateCustomer(tenantId, phone, name);
        
        // Match inteligente para profissional e serviço
        const prof = professionals.find(p => p.name.toLowerCase().includes(result.appointmentDetails.professionalName?.toLowerCase() || "")) || professionals[0];
        const svc = services.find(s => s.name.toLowerCase().includes(result.appointmentDetails.serviceName?.toLowerCase() || "")) || services[0];
        
        const check = await db.isSlotAvailable(tenantId, prof.id, requestedDate, svc.durationMinutes);
        
        if (check.available) {
          const newApp = await db.addAppointment({
            tenant_id: tenantId, 
            customer_id: customer.id, 
            professional_id: prof.id, 
            service_id: svc.id, 
            startTime: requestedDate.toISOString(), 
            durationMinutes: svc.durationMinutes, 
            status: AppointmentStatus.CONFIRMED, 
            source: BookingSource.AI
          });
          
          await sendProfessionalNotification(newApp);
          
          // Sobrescreve a resposta da IA com uma confirmação precisa dos dados reais gravados
          result.replyText = `Show! ✅ Agendado com sucesso:\n\n✂️ *${svc.name}*\n👤 *${prof.name}*\n📅 *${requestedDate.toLocaleDateString('pt-BR')} às ${requestedDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}*\n\nTe esperamos lá!`;
        } else {
          result.replyText = `Poxa, o horário das ${requestedDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})} com ${prof.name} já está ocupado. Quer tentar outro momento?`;
        }
      }
    }

    return result;
  } catch (error: any) {
    return { 
      replyText: "Olá! Notei que você enviou uma mensagem, mas tive um erro temporário no processamento. Pode repetir, por favor?", 
      intent: "CHAT" 
    };
  }
};
