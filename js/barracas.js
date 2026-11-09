// Barracas: acesso ao banco e textos comuns (site, comprovante, Minhas reservas e gestão).
// Tudo separado das salas: tabelas barracas_reservas e barracas_bloqueios.
import { sb, limparErro } from './api.js';
import { SITE_URL } from './config.js';
import { dataLonga, hojeISO, somaDias } from './util.js';

export const TURNOS_BARRACA = [
  { codigo: 'M', nome: 'Manhã' },
  { codigo: 'V', nome: 'Tarde' },
  { codigo: 'N', nome: 'Noite' },
];
export const nomeTurnoBarraca = (c) => (TURNOS_BARRACA.find((t) => t.codigo === c) || {}).nome || c;
const ordemTurno = (c) => TURNOS_BARRACA.findIndex((t) => t.codigo === c);

export const TEXTO_APROVACAO_BARRACA = 'Esta reserva depende de aprovação da secretaria, que deve ocorrer em até 48 horas. Não havendo retorno em até 12 horas antes da data agendada, faça contato com a secretaria paroquial pelo telefone (61) 3354-2921, em horário comercial.';

// Agenda pública do período (só nome da pastoral) e bloqueios
export async function carregarAgendaBarracas(inicio, fim) {
  sb.rpc('expirar_barracas').then(() => {}, () => {});
  const [ra, rb] = await Promise.all([
    sb.from('barracas_agenda_publica').select('*').gte('data', inicio).lte('data', fim),
    sb.from('barracas_bloqueios').select('*').lte('data_inicio', fim).gte('data_fim', inicio),
  ]);
  if (ra.error) throw new Error(limparErro(ra.error));
  if (rb.error) throw new Error(limparErro(rb.error));
  return { agenda: ra.data || [], bloqueios: rb.data || [] };
}

// Situação de um turno: L livre, P pendente, R reservado, B bloqueado, E encerrado/fora do ano
export function situacaoBarraca(ctx, data, turno, admin = false) {
  const b = ctx.bloqueios.find((x) => data >= x.data_inicio && data <= x.data_fim);
  if (b) return { s: 'B', motivo: b.motivo };
  const r = ctx.indice.get(`${data}|${turno}`);
  if (r) return { s: r.status === 'pendente' ? 'P' : 'R', grupo: r.grupo };
  const hoje = hojeISO();
  if (data < hoje) return { s: 'E', texto: 'Data encerrada' };
  if (!admin && data.slice(0, 4) !== hoje.slice(0, 4)) return { s: 'E', texto: 'Fora do ano atual' };
  return { s: 'L' };
}

export function indexarBarracas(agenda) {
  const m = new Map();
  for (const r of agenda || []) m.set(`${r.data}|${r.turno}`, r);
  return m;
}

// Finais de semana com pelo menos um dia no mês: [{ sabado, domingo }]
export function fimDeSemanaDoMes(ano, mes) {
  const pri = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ult = `${ano}-${String(mes).padStart(2, '0')}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`;
  const dow = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  // Sábado da semana do dia 1 (se o dia 1 é domingo, o sábado é o dia anterior)
  let sab = somaDias(pri, dow === 0 ? -1 : 6 - dow);
  const lista = [];
  while (sab <= ult) {
    lista.push({ sabado: sab, domingo: somaDias(sab, 1) });
    sab = somaDias(sab, 7);
  }
  return lista;
}

export async function solicitarBarraca({ turnos, grupo, nome, telefone, mensagem }) {
  const { data, error } = await sb.rpc('solicitar_barraca', {
    p_turnos: turnos, p_grupo: grupo, p_nome: nome, p_telefone: telefone, p_mensagem: mensagem || null,
  });
  if (error) throw new Error(limparErro(error));
  return data;
}

export async function obterComprovanteBarraca(codigo) {
  const { data, error } = await sb.rpc('obter_comprovante_barraca', { p_codigo: codigo });
  if (error) throw new Error(limparErro(error));
  return data || [];
}

export async function cancelarMinhaBarraca(codigo) {
  const { error } = await sb.rpc('cancelar_minha_barraca', { p_codigo: codigo });
  if (error) throw new Error(limparErro(error));
}

// Pedidos de barraca da conta conectada (futuros e dos últimos 30 dias)
export async function minhasBarracas() {
  const { data: s } = await sb.auth.getSession();
  const uid = s.session?.user?.id;
  if (!uid) return [];
  const { data, error } = await sb.from('barracas_reservas')
    .select('codigo, data, turno, status, grupo, motivo_recusa, mensagem')
    .eq('solicitante_id', uid)
    .gte('data', somaDias(hojeISO(), -30))
    .order('data');
  if (error) return [];   // banco ainda sem as tabelas de barracas
  return agruparBarracas(data);
}

// Junta as linhas de um mesmo pedido: { codigo, status, grupo, dias: [{ data, turnos: [...] }] }
export function agruparBarracas(linhas) {
  const m = new Map();
  for (const l of linhas || []) {
    const p = m.get(l.codigo) || { ...l, dias: [] };
    let d = p.dias.find((x) => x.data === l.data);
    if (!d) { d = { data: l.data, turnos: [] }; p.dias.push(d); }
    d.turnos.push(l.turno);
    m.set(l.codigo, p);
  }
  const lista = [...m.values()];
  for (const p of lista) {
    p.dias.sort((a, b) => a.data.localeCompare(b.data));
    p.dias.forEach((d) => d.turnos.sort((a, b) => ordemTurno(a) - ordemTurno(b)));
    p.data = p.dias[0].data;
    p.ultimaData = p.dias[p.dias.length - 1].data;
  }
  return lista.sort((a, b) => a.data.localeCompare(b.data) || a.codigo.localeCompare(b.codigo));
}

// "Sábado, 14 de novembro: manhã e tarde"
export function descreverDias(dias, separador = '; ') {
  return dias.map((d) => `${dataLonga(d.data)}: ${d.turnos.map((t) => nomeTurnoBarraca(t).toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' e $1')}`).join(separador);
}

export function linkComprovanteBarraca(codigo) {
  return `${SITE_URL}/comprovante.html?c=${encodeURIComponent(codigo)}`;
}
