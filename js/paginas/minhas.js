// Minhas reservas: reservas de sala e atendimentos do Direcionamento Espiritual.
// Ativas e futuras: Alterar / Cancelar. Encerradas: Excluir (só tira da lista da pessoa).
import {
  minhasReservas, limparMinhasReservas, meusAtendimentos, cancelarMeuAtendimento,
  cancelarMinhaReserva, ocultarMinhaReserva, ocultarMeuAtendimento,
} from '../api.js';
import { montarPagina, exigirLogin } from '../ui.js';
import { hojeISO, dataLonga, esc, hora, agoraSP } from '../util.js';

const ST_ATEND = {
  solicitado: ['Aguardando confirmação', 'etq-pend'], pendente: ['Aguardando a secretaria', 'etq-pend'],
  agendado: ['Confirmado', 'etq-ok'], realizado: ['Realizado', 'etq-azul'], cancelado: ['Cancelado', 'etq-bloq'],
};
const TIPO_ATEND = { paroquiano: 'Paroquiano', externo: 'Não paroquiano', enfermo: 'Enfermo' };
const ROTULO = {
  confirmada: ['Confirmada', 'etq-ok'], pendente: ['Pendente', 'etq-pend'], recusada: ['Recusada', 'etq-res'],
  cancelada: ['Cancelada', 'etq-bloq'], expirada: ['Expirada', 'etq-bloq'], realizada: ['Realizada', 'etq-azul'],
  nao_compareceu: ['Não compareceu', 'etq-bloq'],
};
const hm = (t) => (t || '').slice(0, 5);

// Já passou do horário (data + hora no fuso de Brasília)?
function passou(data, horaHM) {
  const agora = agoraSP();
  return data < agora.data || (data === agora.data && hm(horaHM) <= agora.hora);
}

// Situação de um pedido de sala
function ativaFutura(p) { return ['pendente', 'confirmada'].includes(p.status) && !passou(p.data, p.primeiroInicio); }
function encerrada(p) { return !['pendente', 'confirmada'].includes(p.status) || passou(p.data, p.ultimoFim); }
// Situação de um atendimento
function atAtivoFuturo(a) { return ['solicitado', 'pendente', 'agendado'].includes(a.status) && !passou(a.data, a.inicio); }
function atEncerrado(a) { return ['cancelado', 'realizado'].includes(a.status) || passou(a.data, a.fim); }

function cartao(p) {
  const [txt, cls] = ROTULO[p.status] || [p.status, 'etq-bloq'];
  const sala = p.salas.nome || `Sala ${p.salas.numero}`;
  let botoes = '';
  if (ativaFutura(p)) {
    botoes = `
      <a class="btn btn-sec btn-peq" href="sala.html?id=${p.sala_id}&data=${p.data}&alterar=${encodeURIComponent(p.codigo)}">Alterar</a>
      <button type="button" class="btn btn-perigo btn-peq" data-cancelar="${esc(p.codigo)}">Cancelar</button>`;
  } else if (encerrada(p)) {
    botoes = `<button type="button" class="btn btn-sec btn-peq" data-excluir="${esc(p.codigo)}">Excluir</button>`;
  }
  return `
    <div class="sala cartao-reserva">
      <a href="comprovante.html?c=${encodeURIComponent(p.codigo)}" class="cartao-link">
        <div class="sala-topo">
          <span class="sala-nome">${esc(sala)}</span>
          <span class="etq ${cls}">${txt}</span>
        </div>
        <span style="font-weight:700">${esc(dataLonga(p.data))}</span>
        <span class="nota">${esc(p.turnos.join(', '))} · ${esc(p.grupo)}</span>
        <span class="nota" style="color:var(--azul);font-weight:700">${esc(p.codigo)}</span>
      </a>
      ${botoes ? `<div class="cartao-acoes">${botoes}</div>` : ''}
    </div>`;
}

function cartaoAtendimento(a) {
  const [txt, cls] = ST_ATEND[a.status] || [a.status, 'etq-bloq'];
  let botoes = '';
  if (atAtivoFuturo(a)) botoes = `<button type="button" class="btn btn-perigo btn-peq" data-cancelar-at="${a.id}">Cancelar pedido</button>`;
  else if (atEncerrado(a)) botoes = `<button type="button" class="btn btn-sec btn-peq" data-excluir-at="${a.id}">Excluir</button>`;
  return `
    <div class="sala cartao-reserva" style="cursor:default">
      <div class="cartao-link">
        <div class="sala-topo">
          <span class="sala-nome">Direcionamento Espiritual</span>
          <span class="etq ${cls}">${txt}</span>
        </div>
        <span style="font-weight:700">${esc(dataLonga(a.data))}, às ${esc(hora(hm(a.inicio) + ':00'))}</span>
        <span class="nota">Com o Pároco · ${esc(TIPO_ATEND[a.tipo] || '')}</span>
      </div>
      ${botoes ? `<div class="cartao-acoes">${botoes}</div>` : ''}
    </div>`;
}

// Liga um grupo de botões a uma ação, com confirmação
function ligar(el, seletor, pergunta, acao) {
  el.querySelectorAll(seletor).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(pergunta)) return;
    b.disabled = true;
    try {
      await acao(b);
      iniciarLista();
    } catch (err) {
      b.disabled = false;
      alert(err.message);
    }
  }));
}

async function iniciar() {
  await montarPagina('minhas');
  if (!exigirLogin()) return;
  iniciarLista();
}

async function iniciarLista() {
  const el = document.getElementById('lista');
  try {
    const [linhas, atendimentos] = await Promise.all([minhasReservas(), meusAtendimentos()]);
    // Agrupa os turnos de um mesmo pedido (mesmo código)
    const pedidos = new Map();
    for (const l of [...linhas].sort((a, b) => (a.turnos.ordem || 0) - (b.turnos.ordem || 0))) {
      const p = pedidos.get(l.codigo) || {
        codigo: l.codigo, sala_id: l.sala_id, data: l.data, status: l.status, salas: l.salas, turnos: [], grupo: l.grupo,
        primeiroInicio: '23:59', ultimoFim: '00:00',
      };
      p.turnos.push(l.turnos.nome);
      if (hm(l.turnos.inicio) < p.primeiroInicio) p.primeiroInicio = hm(l.turnos.inicio);
      if (hm(l.turnos.fim || l.turnos.inicio) > p.ultimoFim) p.ultimoFim = hm(l.turnos.fim || l.turnos.inicio);
      pedidos.set(l.codigo, p);
    }
    const hoje = hojeISO();
    const todos = [...pedidos.values()];
    const proximas = todos.filter((p) => p.data >= hoje).sort((a, b) => a.data.localeCompare(b.data));
    const passadas = todos.filter((p) => p.data < hoje);

    const bt = document.getElementById('limpar-lista');
    const qtd = todos.filter(encerrada).length + atendimentos.filter(atEncerrado).length;
    bt.hidden = !qtd;
    bt.textContent = `Limpar encerradas (${qtd})`;
    bt.onclick = async () => {
      if (!confirm(`Tirar da sua lista ${qtd === 1 ? 'a reserva encerrada' : `as ${qtd} reservas encerradas`} (canceladas, recusadas, passadas ou não comparecidas)? A secretaria continua com o registro.`)) return;
      bt.disabled = true;
      try {
        await limparMinhasReservas();
        bt.disabled = false;
        iniciarLista();
      } catch (e) {
        bt.disabled = false;
        alert(e.message);
      }
    };

    if (!todos.length && !atendimentos.length) { el.innerHTML = '<div class="vazio">Você não tem reservas na lista.</div>'; return; }
    const atend = [...atendimentos].sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio));
    el.innerHTML = `
      <section class="secao">
        <h2>Próximas</h2>
        ${proximas.length ? `<div class="grade-salas">${proximas.map(cartao).join('')}</div>` : '<div class="vazio">Nenhuma reserva de sala futura.</div>'}
      </section>
      ${atend.length ? `<section class="secao" style="margin-top:24px"><h2>Direcionamento Espiritual</h2><div class="grade-salas">${atend.map(cartaoAtendimento).join('')}</div></section>` : ''}
      ${passadas.length ? `<section class="secao" style="margin-top:24px"><h2>Últimos 30 dias</h2><div class="grade-salas">${passadas.map(cartao).join('')}</div></section>` : ''}`;

    ligar(el, '[data-cancelar]', 'Cancelar esta reserva? O turno fica livre para outros grupos. Esta ação não pode ser desfeita.',
      (b) => cancelarMinhaReserva(b.dataset.cancelar));
    ligar(el, '[data-excluir]', 'Tirar esta reserva da sua lista? A secretaria continua com o registro.',
      (b) => ocultarMinhaReserva(b.dataset.excluir));
    ligar(el, '[data-cancelar-at]', 'Cancelar este pedido de Direcionamento Espiritual? O horário fica livre para outra pessoa.',
      (b) => cancelarMeuAtendimento(Number(b.dataset.cancelarAt)));
    ligar(el, '[data-excluir-at]', 'Tirar este atendimento da sua lista?',
      (b) => ocultarMeuAtendimento(Number(b.dataset.excluirAt)));
  } catch (e) {
    el.innerHTML = `<div class="vazio">Não foi possível carregar suas reservas. ${esc(e.message || '')}</div>`;
  }
}

iniciar();
