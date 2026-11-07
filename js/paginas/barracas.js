// Reserva de barracas: 12 meses do ano -> finais de semana do mês -> turnos -> pedido
import { nomesPastorais } from '../api.js';
import { montarPagina, escolherPerfil, faixaPerfil, perfilAtual, sessao, exigirLogin } from '../ui.js';
import { hojeISO, dataLonga, dataCurta, esc, mascaraTelefone, soDigitos, param, MESES, DIAS_LONGOS, diaSemana } from '../util.js';
import {
  TURNOS_BARRACA, TEXTO_APROVACAO_BARRACA, carregarAgendaBarracas, situacaoBarraca, indexarBarracas,
  fimDeSemanaDoMes, solicitarBarraca, nomeTurnoBarraca,
} from '../barracas.js';

const $ = (id) => document.getElementById(id);
const hoje = hojeISO();
const ano = Number(hoje.slice(0, 4));
const mesAtual = Number(hoje.slice(5, 7));
const nomeMes = (m) => MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1);

let ctx = { indice: new Map(), bloqueios: [] };
let mes = null;                      // mês aberto (1 a 12) ou null = tela dos meses
const selecionados = new Set();      // 'AAAA-MM-DD:T'
let enviando = false;

const ehAdmin = () => !!sessao?.admin;
const minhas = () => (sessao && !sessao.admin && sessao.pastorais) || [];

// ---------------------------------------------------------------- dados
async function carregarAno() {
  // Inclui a virada do ano: o fim de semana pode começar em dezembro e terminar em janeiro
  const r = await carregarAgendaBarracas(`${ano - 1}-12-25`, `${ano + 1}-01-07`);
  ctx = { indice: indexarBarracas(r.agenda), bloqueios: r.bloqueios };
  // Turnos que deixaram de estar livres saem da seleção
  for (const k of [...selecionados]) {
    const [d, t] = k.split(':');
    if (situacaoBarraca(ctx, d, t, ehAdmin()).s !== 'L') selecionados.delete(k);
  }
}

// ---------------------------------------------------------------- tela 1: meses
function desenharMeses() {
  $('ano').textContent = ano;
  $('meses').innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
    const passou = m < mesAtual;
    const qtd = [...selecionados].filter((k) => Number(k.slice(5, 7)) === m && Number(k.slice(0, 4)) === ano).length;
    const conteudo = `
      <span class="mes-nome">${nomeMes(m)}</span>
      <span class="mes-ano">${ano}</span>
      <span class="mes-lembrete">${passou ? 'Mês encerrado' : 'Reserve aqui a barraca da sua pastoral'}</span>
      ${qtd ? `<span class="etq etq-livre mes-sel">${qtd === 1 ? '1 turno selecionado' : `${qtd} turnos selecionados`}</span>` : ''}`;
    return passou
      ? `<div class="mes-bloco encerrado" aria-disabled="true">${conteudo}</div>`
      : `<a class="mes-bloco${m === mesAtual ? ' atual' : ''}" href="barracas.html?mes=${m}" data-mes="${m}">${conteudo}</a>`;
  }).join('');
  $('meses').querySelectorAll('[data-mes]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    abrirMes(Number(a.dataset.mes), true);
  }));
}

// ---------------------------------------------------------------- tela 2: finais de semana
function rotuloFim(f) {
  const [, ms, ds] = f.sabado.split('-').map(Number);
  const [, md, dd] = f.domingo.split('-').map(Number);
  return ms === md ? `${ds} e ${dd} de ${MESES[ms - 1]}` : `${ds} de ${MESES[ms - 1]} e ${dd} de ${MESES[md - 1]}`;
}

function blocoTurno(data, t) {
  const st = situacaoBarraca(ctx, data, t.codigo, ehAdmin());
  const k = `${data}:${t.codigo}`;
  if (st.s === 'L') {
    const sel = selecionados.has(k);
    return `<button type="button" class="barr-turno livre${sel ? ' sel' : ''}" data-k="${k}" aria-pressed="${sel}">
      <b>${t.nome}</b><span>${sel ? 'Selecionado' : 'Livre'}</span></button>`;
  }
  const cls = { P: 'pend', R: 'res', B: 'bloq', E: 'bloq' }[st.s];
  const tx = st.s === 'P' ? 'Aguardando aprovação' : st.s === 'R' ? 'Reservado' : st.s === 'B' ? 'Bloqueado' : st.texto;
  const det = st.grupo || st.motivo || '';
  return `<div class="barr-turno ${cls}" aria-label="${esc(`${t.nome}: ${tx}${det ? ` · ${det}` : ''}`)}">
    <b>${t.nome}</b><span>${esc(tx)}</span>${det ? `<small>${esc(det)}</small>` : ''}</div>`;
}

function blocoDia(data) {
  const livres = TURNOS_BARRACA.filter((t) => situacaoBarraca(ctx, data, t.codigo, ehAdmin()).s === 'L');
  const todos = livres.length && livres.every((t) => selecionados.has(`${data}:${t.codigo}`));
  const foraDoMes = Number(data.slice(5, 7)) !== mes;
  return `
    <div class="barr-dia${foraDoMes ? ' fora' : ''}">
      <div class="barr-dia-topo">
        <span><b>${DIAS_LONGOS[diaSemana(data)]}</b> ${esc(dataCurta(data).slice(0, 5))}</span>
        ${livres.length > 1 ? `<button type="button" class="barr-dia-todo" data-dia="${data}" aria-pressed="${!!todos}">${todos ? 'Desmarcar o dia' : 'Dia inteiro'}</button>` : ''}
      </div>
      <div class="barr-turnos">${TURNOS_BARRACA.map((t) => blocoTurno(data, t)).join('')}</div>
    </div>`;
}

function desenharMes() {
  $('mes-titulo').textContent = `${nomeMes(mes)} ${ano}`;
  $('mes-ant').disabled = mes <= mesAtual;
  $('mes-prox').disabled = mes >= 12;
  const fins = fimDeSemanaDoMes(ano, mes);
  $('fins').innerHTML = fins.map((f) => `
    <article class="cartao barr-fim">
      <h3>Fim de semana · ${esc(rotuloFim(f))}</h3>
      <div class="barr-dias">${blocoDia(f.sabado)}${blocoDia(f.domingo)}</div>
    </article>`).join('');

  $('fins').querySelectorAll('.barr-turno.livre').forEach((b) => b.addEventListener('click', () => {
    if (!sessao) { exigirLogin(); return; }
    const k = b.dataset.k;
    if (selecionados.has(k)) selecionados.delete(k); else selecionados.add(k);
    desenharMes();
  }));
  $('fins').querySelectorAll('.barr-dia-todo').forEach((b) => b.addEventListener('click', () => {
    if (!sessao) { exigirLogin(); return; }
    const d = b.dataset.dia;
    const livres = TURNOS_BARRACA.filter((t) => situacaoBarraca(ctx, d, t.codigo, ehAdmin()).s === 'L').map((t) => `${d}:${t.codigo}`);
    const todos = livres.every((k) => selecionados.has(k));
    livres.forEach((k) => (todos ? selecionados.delete(k) : selecionados.add(k)));
    desenharMes();
  }));
  atualizarSelecao();
}

function atualizarSelecao() {
  const n = selecionados.size;
  $('selecao').hidden = n === 0;
  const dias = new Set([...selecionados].map((k) => k.split(':')[0])).size;
  $('selecao-tx').innerHTML = `<b>${n === 1 ? '1 turno' : `${n} turnos`}</b> em ${dias === 1 ? '1 dia' : `${dias} dias`}`;
  $('bt-limpar').disabled = n === 0;
}

// ---------------------------------------------------------------- navegação
function abrirMes(m, empilhar) {
  mes = m;
  if (empilhar) history.pushState({ mes: m }, '', `barracas.html?mes=${m}`);
  $('v-meses').hidden = true;
  $('v-mes').hidden = false;
  desenharMes();
  window.scrollTo({ top: $('v-mes').offsetTop - 12, behavior: 'smooth' });
}

function abrirMeses(empilhar) {
  mes = null;
  if (empilhar) history.pushState({}, '', 'barracas.html');
  $('v-mes').hidden = true;
  $('v-meses').hidden = false;
  desenharMeses();
  atualizarSelecao();
}

// ---------------------------------------------------------------- pedido
function resumoSelecao() {
  const porDia = new Map();
  [...selecionados].sort().forEach((k) => {
    const [d, t] = k.split(':');
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(t);
  });
  const ordem = (c) => TURNOS_BARRACA.findIndex((t) => t.codigo === c);
  return [...porDia.entries()].map(([d, ts]) => `<li><b>${esc(dataLonga(d))}</b><span>${ts.sort((a, b) => ordem(a) - ordem(b)).map(nomeTurnoBarraca).join(', ')}</span></li>`).join('');
}

async function abrirPedido() {
  if (!selecionados.size) return;
  if (!exigirLogin()) return;
  const f = $('f-pedido');
  $('pd-resumo').innerHTML = `<ul>${resumoSelecao()}</ul>`;
  $('pd-msg').hidden = true;
  if (!f.nome.value) f.nome.value = sessao.solicitante?.nome || '';
  if (!f.telefone.value) f.telefone.value = sessao.solicitante?.telefone || '';

  // Pastoral: fixa (uma só), lista das do login (várias) ou lista completa (secretaria)
  let lista = [];
  if (ehAdmin()) lista = (await nomesPastorais()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  else if (minhas().length > 1) lista = minhas();
  $('pd-campo-lista').hidden = !lista.length;
  if (lista.length && f.grupo_lista.options.length <= 1) {
    f.grupo_lista.innerHTML = `<option value="">${ehAdmin() ? 'Selecione na lista' : 'Escolha a pastoral'}</option>`
      + lista.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (lista.includes(sessao.solicitante?.grupo)) f.grupo_lista.value = sessao.solicitante.grupo;
  }
  $('pd-grupo-fixo').innerHTML = !lista.length && minhas().length === 1
    ? `<span class="faixa-perfil">Pastoral: <b>${esc(minhas()[0])}</b></span>` : '';
  $('pd-regra').innerHTML = `<span>${esc(ehAdmin()
    ? 'Reserva feita pela secretaria: confirmada na hora.'
    : TEXTO_APROVACAO_BARRACA)}</span>`;
  $('dlg-pedido').showModal();
}

function erroPedido(texto) {
  const m = $('pd-msg');
  m.className = 'aviso aviso-erro';
  m.textContent = texto;
  m.hidden = false;
}

async function enviarPedido(e) {
  e.preventDefault();
  if (enviando) return;
  const f = $('f-pedido');
  const usaLista = !$('pd-campo-lista').hidden;
  const grupo = usaLista ? f.grupo_lista.value : (minhas()[0] || '');
  if (!grupo) return erroPedido(ehAdmin() ? 'Selecione a pastoral, movimento ou grupo.' : 'Escolha em nome de qual pastoral, movimento ou grupo é a reserva.');
  if (!f.nome.value.trim()) return erroPedido('Informe o nome do responsável.');
  if (soDigitos(f.telefone.value).length < 10) return erroPedido('Informe o telefone com DDD.');
  enviando = true;
  $('pd-enviar').disabled = true;
  $('pd-enviar').textContent = 'Enviando…';
  try {
    const codigo = await solicitarBarraca({
      turnos: [...selecionados].sort(), grupo, nome: f.nome.value.trim(), telefone: f.telefone.value.trim(), mensagem: f.mensagem.value.trim(),
    });
    location.href = `comprovante.html?c=${encodeURIComponent(codigo)}&novo=1`;
  } catch (err) {
    erroPedido(err.message);
    enviando = false;
    $('pd-enviar').disabled = false;
    $('pd-enviar').textContent = 'Solicitar reserva';
    // Atualiza a agenda: algum turno pode ter sido reservado por outra pastoral
    try { await carregarAno(); if (mes) desenharMes(); } catch {}
  }
}

// ---------------------------------------------------------------- início
async function iniciar() {
  await montarPagina('salas');
  await escolherPerfil();
  faixaPerfil($('perfil'));
  $('hoje').textContent = dataLonga(hoje);

  // Barracas: só para paroquianos (pastorais, grupos e movimentos) e a secretaria
  if (perfilAtual() === 'externo' && !ehAdmin()) {
    const a = $('aviso-geral');
    a.className = 'aviso aviso-info';
    a.innerHTML = '<span>A reserva de barracas é exclusiva das pastorais, movimentos e grupos da Paróquia São José. <a href="index.html">Voltar à reserva de salas</a>.</span>';
    a.hidden = false;
    document.querySelector('.abas-site').hidden = true;
    return;
  }

  try {
    await carregarAno();
  } catch (e) {
    const a = $('aviso-geral');
    a.className = 'aviso aviso-erro';
    a.textContent = `Não foi possível carregar a agenda de barracas. ${e.message || ''}`;
    a.hidden = false;
    return;
  }

  mascaraTelefone($('f-pedido').telefone);
  const m = Number(param('mes'));
  if (m >= 1 && m <= 12 && m >= mesAtual) abrirMes(m, false); else abrirMeses(false);

  addEventListener('popstate', () => {
    const p = Number(new URLSearchParams(location.search).get('mes'));
    if (p >= mesAtual && p <= 12) abrirMes(p, false); else abrirMeses(false);
  });
  $('voltar-meses').addEventListener('click', (e) => { e.preventDefault(); abrirMeses(true); });
  $('mes-ant').addEventListener('click', () => { if (mes > mesAtual) abrirMes(mes - 1, true); });
  $('mes-prox').addEventListener('click', () => { if (mes < 12) abrirMes(mes + 1, true); });
  $('bt-limpar').addEventListener('click', () => { selecionados.clear(); if (mes) desenharMes(); else abrirMeses(false); });
  $('bt-continuar').addEventListener('click', abrirPedido);
  $('pd-voltar').addEventListener('click', () => $('dlg-pedido').close());
  $('f-pedido').addEventListener('submit', enviarPedido);
}

iniciar();
