// Agenda da paróquia: junta, por dia, os compromissos da secretaria, os dias bloqueados
// e as reservas de salas, barracas e Direcionamento (confirmadas e pendentes).
// Só leitura das reservas: nada nas regras de reserva muda.
import { sb, limparErro } from './api.js';
import { somaDias } from './util.js';

const TURNO_BARRACA = { M: 'Manhã', V: 'Tarde', N: 'Noite' };
const ORDEM_TURNO = { M: 1, V: 2, N: 3 };
export const hhmm = (t) => (t ? String(t).slice(0, 5).replace(':', 'h') : '');

// Período "19h00 às 21h00" (ou "Dia inteiro")
export function periodoEvento(e) {
  if (e.dia_inteiro || !e.hora_inicio) return 'Dia inteiro';
  return e.hora_fim ? `${hhmm(e.hora_inicio)} às ${hhmm(e.hora_fim)}` : `A partir das ${hhmm(e.hora_inicio)}`;
}

function dia(mapa, d) {
  if (!mapa.has(d)) mapa.set(d, { bloqueios: [], compromissos: [], salas: [], barracas: [], direcionamento: [] });
  return mapa.get(d);
}

// Lê uma consulta ignorando tabelas que ainda não existem no banco (ex.: barracas)
async function ler(consulta, obrigatoria = false) {
  const { data, error } = await consulta;
  if (error) {
    if (obrigatoria) throw new Error(limparErro(error));
    return [];
  }
  return data || [];
}

export async function carregarDiasAgenda(ini, fim) {
  const [eventos, salas, barracas, atend] = await Promise.all([
    // bloqueios de vários dias começam antes do período: busca 60 dias para trás e filtra
    ler(sb.from('agenda_eventos').select('*').gte('data', somaDias(ini, -60)).lte('data', fim).order('data'), true),
    ler(sb.from('reservas').select('codigo, data, status, grupo, motivo, salas(numero, nome), turnos(codigo, nome, inicio)')
      .gte('data', ini).lte('data', fim).in('status', ['pendente', 'confirmada']).order('data').limit(3000)),
    ler(sb.from('barracas_reservas').select('codigo, data, turno, status, grupo')
      .gte('data', ini).lte('data', fim).in('status', ['pendente', 'confirmada']).order('data')),
    ler(sb.from('atendimentos').select('id, data, inicio, fim, nome, tipo, status')
      .gte('data', ini).lte('data', fim).in('status', ['agendado', 'pendente', 'solicitado']).order('data')),
  ]);

  const mapa = new Map();
  for (const e of eventos) {
    if (e.tipo === 'bloqueio') {
      const ate = e.data_fim || e.data;
      for (let d = e.data; d <= ate; d = somaDias(d, 1)) if (d >= ini && d <= fim) dia(mapa, d).bloqueios.push(e);
    } else if (e.data >= ini) {
      dia(mapa, e.data).compromissos.push(e);
    }
  }

  // Salas: uma linha por reserva (código), com os turnos juntos
  const porCodigo = new Map();
  for (const r of salas) {
    const k = `${r.data}|${r.codigo}`;
    const sala = r.salas ? (r.salas.nome || `Sala ${r.salas.numero}`) : 'Sala';
    const item = porCodigo.get(k) || { codigo: r.codigo, data: r.data, sala, numero: r.salas?.numero || '', grupo: r.grupo, aguardando: r.status === 'pendente', turnos: [], ordem: [] };
    item.turnos.push(r.turnos?.nome || '');
    item.ordem.push(r.turnos?.inicio || '');
    porCodigo.set(k, item);
  }
  for (const it of porCodigo.values()) {
    const pares = it.turnos.map((t, i) => [it.ordem[i], t]).sort();
    it.turnos = pares.map((p) => p[1]);
    dia(mapa, it.data).salas.push(it);
  }

  const porBarraca = new Map();
  for (const b of barracas) {
    const k = `${b.data}|${b.codigo}`;
    const it = porBarraca.get(k) || { codigo: b.codigo, data: b.data, grupo: b.grupo, aguardando: b.status === 'pendente', turnos: [] };
    it.turnos.push(b.turno);
    porBarraca.set(k, it);
  }
  for (const it of porBarraca.values()) {
    it.turnos = it.turnos.sort((a, b) => ORDEM_TURNO[a] - ORDEM_TURNO[b]).map((t) => TURNO_BARRACA[t] || t);
    dia(mapa, it.data).barracas.push(it);
  }

  for (const a of atend) {
    dia(mapa, a.data).direcionamento.push({ ...a, aguardando: a.status !== 'agendado' });
  }

  // Ordenação dentro do dia
  for (const d of mapa.values()) {
    d.compromissos.sort((a, b) => (a.dia_inteiro ? '' : a.hora_inicio || '').localeCompare(b.dia_inteiro ? '' : b.hora_inicio || ''));
    d.salas.sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }));
    d.direcionamento.sort((a, b) => a.inicio.localeCompare(b.inicio));
  }
  return mapa;
}

// Linhas de resumo de um dia (aviso do acólito): "Sala 03 · Tarde · Catequese"
export function resumoDoDia(d) {
  if (!d) return [];
  const linhas = [];
  d.bloqueios.forEach((b) => linhas.push({ tipo: 'bloqueio', texto: `Dia bloqueado: ${b.titulo}`, det: b.resumo || '' }));
  d.compromissos.forEach((e) => linhas.push({ tipo: 'compromisso', texto: e.titulo, hora: periodoEvento(e), det: e.resumo || '' }));
  d.salas.forEach((s) => linhas.push({ tipo: 'sala', texto: `${s.sala} · ${s.turnos.join(', ')} · ${s.grupo}`, aguardando: s.aguardando }));
  d.barracas.forEach((b) => linhas.push({ tipo: 'barraca', texto: `Barraca · ${b.turnos.join(', ')} · ${b.grupo}`, aguardando: b.aguardando }));
  d.direcionamento.forEach((a) => linhas.push({ tipo: 'direcionamento', texto: `Direcionamento · ${hhmm(a.inicio)} · ${a.nome}`, aguardando: a.aguardando }));
  return linhas;
}
