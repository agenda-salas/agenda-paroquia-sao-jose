// Disponibilidade de turnos e montagem do calendário mensal
import { hojeISO, somaDias, diaSemana, difDias, DIAS_CURTOS, MESES, agoraSP } from './util.js';

// Índice: "salaId|data|turno" -> { status, grupo }
export function indexarAgenda(agenda) {
  const m = new Map();
  for (const r of agenda || []) m.set(`${r.sala_id}|${r.data}|${r.turno}`, r);
  return m;
}

export function bloqueado(bloqueios, salaId, data, turno) {
  return (bloqueios || []).find((b) => b.sala_id === salaId && data >= b.data_inicio && data <= b.data_fim
    && (!b.turnos || b.turnos.length === 0 || b.turnos.includes(turno)));
}

// Situação de um turno: X = não funciona, B = bloqueado, P = pendente, R = reservado, L = livre
export function situacaoTurno(ctx, salaId, data, turno) {
  if (!turno.dias_semana.includes(diaSemana(data))) return { s: 'X' };
  const b = bloqueado(ctx.bloqueios, salaId, data, turno.codigo);
  if (b) return { s: 'B', motivo: b.motivo };
  const r = ctx.indice.get(`${salaId}|${data}|${turno.codigo}`);
  if (r) return { s: r.status === 'pendente' ? 'P' : 'R', grupo: r.grupo };
  return { s: 'L' };
}

// Pode reservar este turno agora? (antecedência mínima e janela)
// A secretaria reserva qualquer turno que ainda não começou.
export function turnoReservavel(data, turno, cfg, admin = false) {
  if (admin) return new Date(`${data}T${turno.inicio.slice(0, 5)}:00-03:00`).getTime() > Date.now();
  const antecedencia = Number(cfg.antecedencia_min_horas || 24);
  const janela = Number(cfg.janela_dias || 15);
  if (difDias(hojeISO(), data) > janela) return false;
  const inicio = new Date(`${data}T${turno.inicio.slice(0, 5)}:00-03:00`);
  return inicio.getTime() >= Date.now() + antecedencia * 3600 * 1000;
}

// Cor do dia: livre / parcial / cheio / off
export function corDoDia(ctx, salaId, data, cfg) {
  const hoje = hojeISO();
  const janela = Number(cfg.janela_dias || 15);
  if (data < hoje || difDias(hoje, data) > janela) return { cor: 'off', turnos: [] };
  const turnos = ctx.turnos.map((t) => ({ t, ...situacaoTurno(ctx, salaId, data, t) }));
  const validos = turnos.filter((x) => x.s !== 'X');
  if (validos.length === 0 || validos.every((x) => x.s === 'B')) return { cor: 'off', turnos, bloqueado: validos.length > 0 };
  const livres = validos.filter((x) => x.s === 'L').length;
  const abertos = validos.filter((x) => x.s !== 'B').length;
  const cor = livres === 0 ? 'cheio' : livres === abertos ? 'livre' : 'parcial';
  return { cor, turnos };
}

// Turno em andamento agora (ou null)
export function turnoAtual(turnos) {
  const { hora } = agoraSP();
  return turnos.find((t) => hora >= t.inicio.slice(0, 5) && hora < t.fim.slice(0, 5)) || null;
}

// Faixa de 7 dias a partir de hoje para os quadros da tela inicial
export function resumoSemana(ctx, salaId, cfg) {
  const hoje = hojeISO();
  let livres = 0, total = 0;
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = somaDias(hoje, i);
    const turnos = ctx.turnos.map((t) => situacaoTurno(ctx, salaId, d, t)).filter((x) => x.s !== 'X');
    total += turnos.length;
    livres += turnos.filter((x) => x.s === 'L').length;
    const l = turnos.filter((x) => x.s === 'L').length;
    const abertos = turnos.filter((x) => x.s !== 'B').length;
    const cor = abertos === 0 ? 'off' : l === 0 ? 'cheio' : l === abertos ? 'livre' : 'parcial';
    dias.push({ data: d, letra: DIAS_CURTOS[diaSemana(d)][0], cor });
  }
  return { dias, livres, total };
}

// Situação da sala neste momento
export function situacaoAgora(ctx, salaId) {
  const hoje = hojeISO();
  const t = turnoAtual(ctx.turnos);
  if (bloqueado(ctx.bloqueios, salaId, hoje, t?.codigo || '__dia')) {
    const b = bloqueado(ctx.bloqueios, salaId, hoje, t?.codigo || '__dia');
    return { classe: 'selo-bloq', texto: `Bloqueada · ${b.motivo}` };
  }
  if (t) {
    const s = situacaoTurno(ctx, salaId, hoje, t);
    if (s.s === 'B') return { classe: 'selo-bloq', texto: `Bloqueada · ${s.motivo}` };
    if (s.s === 'R') return { classe: 'selo-uso', texto: `Em uso · ${s.grupo}` };
  }
  return { classe: 'selo-livre', texto: 'Livre agora' };
}

// Matriz do mês (domingo a sábado): células com data ou null
export function celulasDoMes(ano, mes) {
  const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const inicio = diaSemana(primeiro);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const cel = [];
  for (let i = 0; i < inicio; i++) cel.push(null);
  for (let d = 1; d <= ultimo; d++) cel.push(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cel.length % 7) cel.push(null);
  return cel;
}

export function nomeMes(ano, mes) {
  const n = MESES[mes - 1];
  return `${n[0].toUpperCase()}${n.slice(1)} ${ano}`;
}
