// Agenda da sala: calendário mensal + painel do dia
import { carregarSala, carregarTurnos, carregarAgenda, carregarBloqueios, carregarConfig, nomeSala } from '../api.js';
import { montarPagina, avisoCache, sessao, perfilAtual } from '../ui.js';
import { hojeISO, param, dataLonga, faixa, esc, DIAS_CURTOS } from '../util.js';
import { indexarAgenda, corDoDia, situacaoTurno, turnoReservavel, celulasDoMes, nomeMes } from '../calendario.js';

const salaId = Number(param('id'));
let sala, cfg, ctx;
let [ano, mes] = hojeISO().split('-').map(Number);
let diaSel = null;

const $ = (id) => document.getElementById(id);

function turnosMarcados() {
  return [...document.querySelectorAll('#painel input[name="turno"]:checked')].map((i) => i.value);
}

function atualizarBotao() {
  const n = turnosMarcados().length;
  $('bt-reservar').disabled = n === 0;
  const b = $('bt-reservar-painel');
  if (b) {
    b.hidden = n === 0;
    b.textContent = n === 1 ? 'Reservar 1 turno selecionado' : `Reservar ${n} turnos selecionados`;
  }
}

function irParaReserva() {
  const t = turnosMarcados();
  if (!t.length || !diaSel) return;
  const alt = param('alterar');
  location.href = `reservar.html?sala=${salaId}&data=${diaSel}&turnos=${t.join(',')}${alt ? `&alterar=${encodeURIComponent(alt)}` : ''}`;
}

function desenharPainel() {
  const p = $('painel');
  if (!diaSel) { p.innerHTML = '<p class="nota">Toque em um dia para ver os turnos.</p>'; atualizarBotao(); return; }
  const linhas = ctx.turnos.map((t) => {
    const s = situacaoTurno(ctx, salaId, diaSel, t);
    if (s.s === 'X') return '';
    const quando = `${t.nome}`;
    if (s.s === 'L') {
      const pode = turnoReservavel(diaSel, t, cfg, sessao?.admin);
      if (!pode) {
        return `<div class="turno"><span class="marcador"></span><span class="turno-tx"><b>${quando}</b><span>${faixa(t)} · fora do prazo de reserva</span></span><span class="etq etq-bloq">Indisponível</span></div>`;
      }
      return `<label class="turno livre"><input type="checkbox" name="turno" value="${t.codigo}"><span class="turno-tx"><b>${quando}</b><span>${faixa(t)}</span></span><span class="etq etq-livre">Livre</span></label>`;
    }
    if (s.s === 'B') return `<div class="turno"><span class="marcador"></span><span class="turno-tx"><b>${quando}</b><span>${faixa(t)} · ${esc(s.motivo)}</span></span><span class="etq etq-bloq">Bloqueada</span></div>`;
    if (s.s === 'P') return `<div class="turno pend"><span class="marcador"></span><span class="turno-tx"><b>${quando}</b><span>${faixa(t)} · ${esc(s.grupo)}</span></span><span class="etq etq-pend">Pendente</span></div>`;
    return `<div class="turno"><span class="marcador"></span><span class="turno-tx"><b>${quando}</b><span>${faixa(t)} · ${esc(s.grupo)}</span></span><span class="etq etq-res">Reservado</span></div>`;
  }).join('');

  const regra = sessao?.admin
    ? 'Reserva da secretaria: confirmada na hora, sem antecedência mínima.'
    : perfilAtual() === 'externo'
    ? `Não paroquiano: a reserva será confirmada pela secretaria em no máximo ${esc(cfg.prazo_aprovacao_horas || 48)} horas.`
    : sala.controlada
    ? `Esta sala exige aprovação da secretaria. A reserva fica pendente por até ${esc(cfg.prazo_aprovacao_horas || 48)} h.`
    : 'Sala comum: a reserva é confirmada na hora.';

  p.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:2px">
      <span class="nota" style="font-weight:600">Dia selecionado</span>
      <h2 style="font-size:20px">${esc(dataLonga(diaSel))}</h2>
    </div>
    ${linhas}
    <button type="button" class="btn btn-grande" id="bt-reservar-painel" hidden></button>
    <p class="nota" style="margin:0;font-size:12.5px">${regra}${sessao?.admin ? '' : ` Alterações e cancelamentos até o início do turno. Reservas com ${esc(cfg.antecedencia_min_horas || 6)} h de antecedência.`}</p>`;
  p.querySelectorAll('input[name="turno"]').forEach((i) => i.addEventListener('change', atualizarBotao));
  $('bt-reservar-painel').addEventListener('click', irParaReserva);
  atualizarBotao();
}

function desenharMes() {
  $('mes').textContent = nomeMes(ano, mes);
  const hoje = hojeISO();
  const cab = DIAS_CURTOS.map((d) => `<span class="cal-sem">${d}</span>`).join('');
  const cels = celulasDoMes(ano, mes).map((d) => {
    if (!d) return '<span></span>';
    const info = corDoDia(ctx, salaId, d, cfg);
    const n = Number(d.slice(8));
    const marca = d === hoje ? 'Hoje' : info.bloqueado ? 'Bloq.' : '';
    const chips = info.cor === 'off' ? '' : info.turnos.map((x) => {
      const k = x.s === 'X' ? 'X' : x.s === 'L' ? 'L' : x.s === 'P' ? 'P' : 'R';
      return `<span class="chip chip-${k}">${x.s === 'X' ? '–' : x.t.codigo}</span>`;
    }).join('');
    const desab = info.cor === 'off' && !(d >= hoje);
    return `<button type="button" class="dia c-${info.cor}${d === hoje ? ' hoje' : ''}${d === diaSel ? ' sel' : ''}" data-dia="${d}" ${desab ? 'disabled' : ''} aria-label="${esc(dataLonga(d))}">
      <span class="dia-num"><b>${n}</b><small>${marca}</small></span>
      <span class="chips">${chips}</span>
    </button>`;
  }).join('');
  $('grade').innerHTML = cab + cels;
  $('grade').querySelectorAll('.dia[data-dia]').forEach((b) => b.addEventListener('click', () => {
    diaSel = b.dataset.dia;
    desenharMes();
    desenharPainel();
    if (window.innerWidth < 900) $('painel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

async function carregarMes() {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${new Date(Date.UTC(ano, mes, 0)).getUTCDate()}`;
  const [ra, rb] = await Promise.all([carregarAgenda(inicio, fim, salaId), carregarBloqueios(inicio, fim, salaId)]);
  ctx.indice = indexarAgenda(ra.dados);
  ctx.bloqueios = rb.dados;
  $('cache').innerHTML = avisoCache(ra.deCache);
  desenharMes();
  desenharPainel();
}

function mudarMes(delta) {
  mes += delta;
  if (mes < 1) { mes = 12; ano--; }
  if (mes > 12) { mes = 1; ano++; }
  carregarMes();
}

async function iniciar() {
  await montarPagina('salas');
  if (!salaId) { location.href = 'index.html'; return; }
  try {
    const [s, c, rt] = await Promise.all([carregarSala(salaId), carregarConfig(), carregarTurnos()]);
    if (!s) { $('sala-nome').textContent = 'Sala não encontrada'; return; }
    sala = s; cfg = c;
    ctx = { turnos: rt.dados, indice: new Map(), bloqueios: [] };
    document.title = `${nomeSala(sala)} · Sistema de Reservas`;
    $('sala-nome').textContent = nomeSala(sala);
    $('sala-tipo').textContent = `${sala.tipo === 'palestra' ? 'Sala de palestra' : 'Sala'} para ${sala.capacidade} pessoas · ${sala.controlada ? 'aprovação da secretaria' : 'confirmação na hora'}`;
    if (param('alterar')) {
      const b = document.createElement('div');
      b.className = 'aviso aviso-info aviso-alterando';
      b.innerHTML = `<span><b>Alterando a reserva ${esc(param('alterar'))}.</b> Escolha o novo dia e os turnos, depois toque em Reservar. A reserva atual só é cancelada quando a nova for confirmada.</span>`;
      document.querySelector('.agenda-topo').before(b);
    }
    const d = param('data');
    if (d) { diaSel = d; [ano, mes] = d.split('-').map(Number); }
    await carregarMes();
  } catch (e) {
    $('painel').innerHTML = `<div class="vazio">Não foi possível carregar a agenda. ${esc(e.message || '')}</div>`;
  }

  $('mes-ant').addEventListener('click', () => mudarMes(-1));
  $('mes-prox').addEventListener('click', () => mudarMes(1));
  $('mes-hoje').addEventListener('click', () => { [ano, mes] = hojeISO().split('-').map(Number); carregarMes(); });
  $('bt-reservar').addEventListener('click', irParaReserva);
  $('bt-limpar').addEventListener('click', () => { diaSel = null; desenharMes(); desenharPainel(); });
}

iniciar();
