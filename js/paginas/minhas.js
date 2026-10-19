// Minhas reservas: próximas e recentes, com link para o comprovante
import { minhasReservas, limparMinhasReservas, meusAtendimentos, cancelarMeuAtendimento } from '../api.js';
import { montarPagina, exigirLogin } from '../ui.js';
import { hojeISO, dataLonga, esc, hora, agoraSP } from '../util.js';

const ST_ATEND = {
  solicitado: ['Aguardando confirmação', 'etq-pend'], pendente: ['Aguardando a secretaria', 'etq-pend'],
  agendado: ['Confirmado', 'etq-ok'], realizado: ['Realizado', 'etq-azul'], cancelado: ['Cancelado', 'etq-bloq'],
};
const TIPO_ATEND = { paroquiano: 'Paroquiano', externo: 'Não paroquiano', enfermo: 'Enfermo' };
const hm = (t) => (t || '').slice(0, 5);

function cartaoAtendimento(a) {
  const [txt, cls] = ST_ATEND[a.status] || [a.status, 'etq-bloq'];
  const agora = agoraSP();
  const futuro = a.data > agora.data || (a.data === agora.data && hm(a.inicio) > agora.hora);
  const podeCancelar = futuro && ['solicitado', 'pendente', 'agendado'].includes(a.status);
  return `
    <div class="sala" style="gap:8px;cursor:default">
      <div class="sala-topo">
        <span class="sala-nome">Direcionamento Espiritual</span>
        <span class="etq ${cls}">${txt}</span>
      </div>
      <span style="font-weight:700">${esc(dataLonga(a.data))}, às ${esc(hora(hm(a.inicio) + ':00'))}</span>
      <span class="nota">Com o Pároco · ${esc(TIPO_ATEND[a.tipo] || '')}</span>
      ${podeCancelar ? `<button type="button" class="btn btn-sec btn-peq" style="align-self:flex-start" data-cancelar-at="${a.id}">Cancelar pedido</button>` : ''}
    </div>`;
}

const ROTULO = {
  confirmada: ['Confirmada', 'etq-ok'], pendente: ['Pendente', 'etq-pend'], recusada: ['Recusada', 'etq-res'],
  cancelada: ['Cancelada', 'etq-bloq'], expirada: ['Expirada', 'etq-bloq'], realizada: ['Realizada', 'etq-azul'],
  nao_compareceu: ['Não compareceu', 'etq-bloq'],
};

function cartao(p) {
  const [txt, cls] = ROTULO[p.status] || [p.status, 'etq-bloq'];
  const sala = p.salas.nome || `Sala ${p.salas.numero}`;
  return `
    <a href="comprovante.html?c=${encodeURIComponent(p.codigo)}" class="sala" style="gap:8px">
      <div class="sala-topo">
        <span class="sala-nome">${esc(sala)}</span>
        <span class="etq ${cls}">${txt}</span>
      </div>
      <span style="font-weight:700">${esc(dataLonga(p.data))}</span>
      <span class="nota">${esc(p.turnos.join(', '))} · ${esc(p.grupo)}</span>
      <span class="nota" style="color:var(--azul);font-weight:700">${esc(p.codigo)}</span>
    </a>`;
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
    for (const l of linhas) {
      const p = pedidos.get(l.codigo) || { codigo: l.codigo, data: l.data, status: l.status, salas: l.salas, turnos: [], ordem: [], grupo: l.grupo };
      p.turnos.push(l.turnos.nome);
      pedidos.set(l.codigo, p);
    }
    const hoje = hojeISO();
    const todos = [...pedidos.values()];
    const proximas = todos.filter((p) => p.data >= hoje).sort((a, b) => a.data.localeCompare(b.data));
    const passadas = todos.filter((p) => p.data < hoje);
    const bt = document.getElementById('limpar-lista');
    const encerradas = [...todos.filter((p) => ['cancelada', 'recusada'].includes(p.status)),
      ...atendimentos.filter((a) => a.status === 'cancelado')];
    bt.hidden = !encerradas.length;
    bt.textContent = `Limpar canceladas e recusadas (${encerradas.length})`;
    bt.onclick = async () => {
      if (!confirm(`Tirar da sua lista ${encerradas.length === 1 ? 'a reserva cancelada ou recusada' : `as ${encerradas.length} reservas canceladas e recusadas`}? A secretaria continua com o registro.`)) return;
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
    el.querySelectorAll('[data-cancelar-at]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Cancelar este pedido de Direcionamento Espiritual? O horário fica livre para outra pessoa.')) return;
      b.disabled = true;
      try {
        await cancelarMeuAtendimento(Number(b.dataset.cancelarAt));
        iniciarLista();
      } catch (err) {
        b.disabled = false;
        alert(err.message);
      }
    }));
  } catch (e) {
    el.innerHTML = `<div class="vazio">Não foi possível carregar suas reservas. ${esc(e.message || '')}</div>`;
  }
}

iniciar();
