
import { db } from './mockDb';
import { Appointment } from '../types';
import { evolutionService } from './evolutionService';

export const sendProfessionalNotification = async (app: Appointment) => {
  const [professionals, services, customers, tenants] = await Promise.all([
    db.getProfessionals(app.tenant_id),
    db.getServices(app.tenant_id),
    db.getCustomers(app.tenant_id),
    db.getAllTenants()
  ]);

  const prof = professionals.find(p => p.id === app.professional_id);
  const svc = services.find(s => s.id === app.service_id);
  const cus = customers.find(c => c.id === app.customer_id);
  const tenant = tenants.find(t => t.id === app.tenant_id);

  if (!prof || !svc || !cus || !tenant) return;

  const dateObj = new Date(app.startTime);
  const dateFormatted = dateObj.toLocaleDateString('pt-BR');
  const timeFormatted = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const message = `
📌 *NOVO AGENDAMENTO!*

Olá *${prof.name}*, um novo horário foi agendado para você:

👤 *Cliente:* ${cus.name}
📱 *Telefone:* ${cus.phone}
✂️ *Serviço:* ${svc.name}
📅 *Data:* ${dateFormatted}
⏰ *Hora:* ${timeFormatted}

_Agendamento realizado via AgendeZap IA_
  `.trim();

  // Usa o slug do tenant para identificar a instância correta na Evolution API
  const instanceName = evolutionService.getInstanceName(tenant.slug);
  await evolutionService.sendMessage(instanceName, prof.phone, message);
};
