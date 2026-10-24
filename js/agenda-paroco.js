// Direcionamento Espiritual: agenda mensal do Pároco, dentro da Área de Gestão.
// Os elementos da página têm o prefixo "at-" (ex.: at-dias, at-msg).
import { sb, limparErro } from './api.js';
import {
  esc, hojeISO, somaDias, diaSemana, dataLonga, dataCurta, hora, agoraSP,
  linkWhatsApp, primeiroNome, mascaraTelefone, soDigitos, DIAS_LONGOS, MESES,
} from './util.js';

const $ = (id) => document.getElementById(`at-${id}`);
const PUBLICO = { paroquianos: 'Paroquianos', enfermos: 'Enfermos' };
const TIPO = { paroquiano: 'Paroquiano', externo: 'Não paroquiano', enfermo: 'Enfermo' };

let usuario = null;
let ehSecretaria = false;
let inicioMes = primeiroDoMes(hojeISO());
let horarios = [];
let atendimentos = [];
let pendentes = [];        // pedidos aguardando confirmação (todas as datas futuras)
let bloqueios = [];
let slotAtual = null;

// ---------------------------------------------------------------- utilidades
function primeiroDoMes(iso) { return `${iso.slice(0, 7)}-01`; }
function ultimoDoMes(iso) {
  const [a, m] = iso.split('-').map(Number);
  return `${iso.slice(0, 7)}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
function outroMes(iso, n) {
  const [a, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
const hm = (t) => (t || '').slice(0, 5); // '16:00:00' -> '16:00'
function somaMin(t, min) {
  const [h, m] = hm(t).split(':').map(Number);
  const total = h * 60 + m + min;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
const faixaHora = (a, b) => `${hora(hm(a) + ':00')} às ${hora(hm(b) + ':00')}`;

function aviso(tipo, texto, extraHtml = '') {
  const el = $('msg');
  el.className = `aviso aviso-${tipo}`;
  el.innerHTML = `<span>${esc(texto)}${extraHtml ? ' ' + extraHtml : ''}</span>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function erroEm(id, texto) {
  const el = $(id);
  el.textContent = texto;
  el.hidden = !texto;
}

function passou(data, fim) {
  const agora = agoraSP();
  return data < agora.data || (data === agora.data && hm(fim) <= agora.hora);
}

function bloqueioDo(data, ini, fim) {
  return bloqueios.find((b) => data >= b.data_inicio && data <= b.data_fim
    && (!b.inicio || (hm(ini) < hm(b.fim || '24:00') && hm(fim) > hm(b.inicio))));
}

// Horários livres/ocupados de um dia, a partir da grade
function slotsDoDia(data) {
  const dow = diaSemana(data);
  const lista = [];
  horarios.filter((h) => h.ativo && h.dia_semana === dow).forEach((h) => {
    let ini = hm(h.inicio);
    while (somaMin(ini, h.duracao_min) <= hm(h.fim)) {
      const fim = somaMin(ini, h.duracao_min);
      lista.push({ data, inicio: ini, fim, publico: h.publico });
      ini = fim;
    }
  });
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

function textoAgendado(a) {
  const quando = `${dataLonga(a.data).toLowerCase()}, às ${hora(hm(a.inicio) + ':00')}`;
  if (a.status === 'pendente' || a.status === 'solicitado') {
    return `Olá, ${primeiroNome(a.nome)}! Recebemos o pedido de Direcionamento Espiritual com o Pároco da Paróquia São José para ${quando}. `
      + `Ele aguarda a confirmação ${a.status === 'pendente' ? 'da secretaria' : 'da secretaria ou do Pároco'}. Avisaremos assim que for confirmado.`;
  }
  if (a.tipo === 'enfermo') {
    return `Olá, ${primeiroNome(a.nome)}! O atendimento do Pároco da Paróquia São José ao enfermo está agendado para ${quando}, no local: ${a.local_atendimento || a.endereco}.`;
  }
  return `Olá, ${primeiroNome(a.nome)}! Seu Direcionamento Espiritual com o Pároco da Paróquia São José está agendado para ${quando}. `
    + 'Em caso de imprevisto, avise a secretaria.';
}

function linkAvisar(a, texto, rotulo = 'Avisar no WhatsApp') {
  return `<a href="${linkWhatsApp(a.telefone, texto)}" target="_blank" rel="noopener">${esc(rotulo)}</a>`;
}

// ---------------------------------------------------------------- dados
async function carregarHorarios() {
  const { data, error } = await sb.from('atend_horarios').select('*').order('dia_semana').order('inicio');
  if (error) throw error;
  horarios = data;
}

async function carregarSemana() {
  const ini = inicioMes;
  const fim = ultimoDoMes(ini);
  const [{ data: a, error: e1 }, { data: b, error: e2 }, { data: p, error: e3 }] = await Promise.all([
    sb.from('atendimentos').select('*').gte('data', ini).lte('data', fim)
      .in('status', ['agendado', 'pendente', 'solicitado', 'realizado']).order('data').order('inicio'),
    sb.from('atend_bloqueios').select('*').lte('data_inicio', fim).gte('data_fim', ini),
    sb.from('atendimentos').select('*').gte('data', hojeISO())
      .in('status', ['pendente', 'solicitado']).order('data').order('inicio'),
  ]);
  if (e1 || e2 || e3) { aviso('erro', limparErro(e1 || e2 || e3)); return; }
  atendimentos = a;
  bloqueios = b;
  pendentes = p || [];
  desenharPendentes();
  desenhar();
}

// ---------------------------------------------------------------- pedidos aguardando (cartões, como na aba Aprovações)
function desenharPendentes() {
  const n = pendentes.length;
  $('pend-resumo').textContent = n ? `${n} ${n === 1 ? 'pedido aguardando' : 'pedidos aguardando'}` : '';
  if (!n) { $('pend').innerHTML = '<div class="vazio">Nenhum pedido aguardando confirmação.</div>'; return; }
  $('pend').innerHTML = `<div class="grade-salas" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${pendentes.map((a) => {
    const pend = a.status === 'pendente';
    return `
      <article class="cartao" style="display:flex;flex-direction:column;gap:8px;border-top:4px solid var(--dourado)">
        <div class="sala-topo">
          <span class="sala-nome">Direcionamento Espiritual</span>
          <span class="etq ${a.tipo === 'enfermo' || a.tipo === 'externo' ? 'etq-externo' : 'etq-azul'}">${TIPO[a.tipo]}</span>
        </div>
        <b>${esc(dataLonga(a.data))} · ${esc(hora(hm(a.inicio) + ':00'))}</b>
        <span><b>${esc(a.nome)}</b></span>
        ${a.pastoral ? `<span class="nota"><b>Pastoral:</b> ${esc(a.pastoral)}</span>` : ''}
        <span class="nota"><a href="${linkWhatsApp(a.telefone, '')}" target="_blank" rel="noopener">${esc(a.telefone)}</a></span>
        ${a.local_atendimento ? `<span class="nota"><b>Local:</b> ${esc(a.local_atendimento)}</span>` : ''}
        ${a.endereco ? `<span class="nota"><b>${a.tipo === 'enfermo' ? 'Residência' : 'Endereço'}:</b> ${esc(a.endereco)}</span>` : ''}
        ${a.tipo === 'externo' ? `<span class="nota">${esc(a.paroquia_origem || '')} · ${esc(a.paroco_responsavel || '')}</span>` : ''}
        ${a.assunto ? `<span class="nota">${a.tipo === 'enfermo' ? 'Observações' : 'Assunto'}: ${esc(a.assunto)}</span>` : ''}
        ${a.criado_em ? `<span class="nota" style="font-size:12px">Pedido em ${new Date(a.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}
        ${pend && !ehSecretaria ? '<span class="etq etq-pend" style="align-self:flex-start">Aguardando a secretaria</span>' : ''}
        <div class="acoes">
          ${pend ? (ehSecretaria ? `<button type="button" class="btn" data-acao="liberar" data-id="${a.id}">Liberar</button>` : '')
            : `<button type="button" class="btn" data-acao="confirmar" data-id="${a.id}">Confirmar</button>`}
          <button type="button" class="btn btn-perigo" data-acao="recusar" data-id="${a.id}">Recusar</button>
        </div>
      </article>`;
  }).join('')}</div>`;
  $('pend').querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', () => acao(b.dataset.acao, b.dataset)));
}

// ---------------------------------------------------------------- agenda
function desenhar() {
  const fim = ultimoDoMes(inicioMes);
  const [a1, m1] = inicioMes.split('-').map(Number);
  const nomeMes = MESES[m1 - 1];
  $('sem-titulo').textContent = `${nomeMes[0].toUpperCase()}${nomeMes.slice(1)} de ${a1}`;

  const dias = [];
  for (let data = inicioMes; data <= fim; data = somaDias(data, 1)) {
    const slots = slotsDoDia(data);
    // atendimentos fora da grade atual (grade mudou depois) também aparecem
    atendimentos.filter((x) => x.data === data && !slots.some((s) => s.inicio === hm(x.inicio)))
      .forEach((x) => slots.push({ data, inicio: hm(x.inicio), fim: hm(x.fim), publico: x.tipo === 'enfermo' ? 'enfermos' : 'paroquianos' }));
    if (slots.length) dias.push({ data, slots: slots.sort((p, q) => p.inicio.localeCompare(q.inicio)) });
  }

  $('sem-dias-msg').textContent = horarios.some((h) => h.ativo)
    ? 'São mostrados apenas os dias com horário de atendimento.'
    : 'Nenhum horário de atendimento cadastrado. Use "Horários de atendimento".';

  $('dias').innerHTML = dias.map(({ data, slots }) => {
    const publicos = [...new Set(slots.map((s) => s.publico))];
    const hoje = data === hojeISO();
    return `
      <article class="cartao dia-atend linha-dourada${hoje ? ' dia-hoje' : ''}">
        <div class="dia-atend-cab">
          <div>
            <h3>${esc(DIAS_LONGOS[diaSemana(data)])}${hoje ? ' <span class="etq etq-ok">Hoje</span>' : ''}</h3>
            <span class="nota">${esc(dataCurta(data))}</span>
          </div>
          <div class="acoes">${publicos.map((p) => `<span class="etq ${p === 'enfermos' ? 'etq-externo' : 'etq-azul'}">${PUBLICO[p]}</span>`).join('')}</div>
        </div>
        <ul class="slots">${slots.map((s) => slotHtml(s)).join('')}</ul>
      </article>`;
  }).join('') || '<div class="vazio">Não há horários de atendimento neste mês.</div>';

  $('dias').querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', () => acao(b.dataset.acao, b.dataset)));
}

function slotHtml(s) {
  const a = atendimentos.find((x) => x.data === s.data && hm(x.inicio) === s.inicio);
  const faixa = `${s.inicio.replace(':', 'h')}`;
  const ds = `data-data="${s.data}" data-inicio="${s.inicio}" data-fim="${s.fim}" data-publico="${s.publico}"`;
  const velho = passou(s.data, s.fim);

  if (a && (a.status === 'pendente' || a.status === 'solicitado')) {
    return `
      <li class="slot slot-pend">
        <span class="slot-hora">${faixa}</span>
        <div class="slot-corpo">
          <span><b>${esc(a.nome)}</b> · ${esc(TIPO[a.tipo])}</span>
          <span class="nota">Aguardando confirmação · ver pedidos acima</span>
        </div>
      </li>`;
  }

  if (a) {
    const pend = a.status === 'pendente';
    const solic = a.status === 'solicitado';
    const extra = a.tipo === 'externo'
      ? `<span class="nota">${esc(a.paroquia_origem || '')} · ${esc(a.paroco_responsavel || '')}</span>` : '';
    return `
      <li class="slot ${pend || solic ? 'slot-pend' : 'slot-ocupado'}">
        <span class="slot-hora">${faixa}</span>
        <div class="slot-corpo">
          <span class="slot-titulo"><b>${esc(a.nome)}</b>
            <span class="etq ${a.tipo === 'externo' ? 'etq-externo' : a.tipo === 'enfermo' ? 'etq-externo' : 'etq-azul'}">${TIPO[a.tipo]}</span>
            ${a.status === 'realizado' ? '<span class="etq etq-ok">Realizado</span>' : ''}
          </span>
          ${extra}
          ${a.pastoral ? `<span class="nota"><b>Pastoral:</b> ${esc(a.pastoral)}</span>` : ''}
          ${a.local_atendimento ? `<span class="nota"><b>Local:</b> ${esc(a.local_atendimento)}</span>` : ''}
          ${a.endereco ? `<span class="nota">${a.tipo === 'enfermo' ? '<b>Residência:</b> ' : ''}${esc(a.endereco)}</span>` : ''}
          ${a.assunto ? `<span class="nota">${esc(a.assunto)}</span>` : ''}
          <a href="${linkWhatsApp(a.telefone, '')}" target="_blank" rel="noopener" class="nota">${esc(a.telefone)}</a>
          <span class="acoes slot-acoes">
            ${pend && ehSecretaria ? `<button type="button" class="btn btn-peq" data-acao="liberar" data-id="${a.id}">Liberar</button>` : ''}
            ${solic ? `<button type="button" class="btn btn-peq" data-acao="confirmar" data-id="${a.id}">Confirmar</button>` : ''}
            ${(pend || solic) && !velho ? `<button type="button" class="btn btn-perigo btn-peq" data-acao="recusar" data-id="${a.id}">Recusar</button>` : ''}
            ${a.status === 'agendado' && velho ? `<button type="button" class="btn btn-peq" data-acao="realizado" data-id="${a.id}">Realizado</button>` : ''}
            ${!velho ? `<button type="button" class="btn btn-peq" data-acao="avisar" data-id="${a.id}">Avisar</button>` : ''}
            <button type="button" class="btn btn-perigo btn-peq" data-acao="excluir" data-id="${a.id}">Excluir</button>
          </span>
        </div>
      </li>`;
  }

  const b = bloqueioDo(s.data, s.inicio, s.fim);
  if (b) {
    return `
      <li class="slot slot-bloq">
        <span class="slot-hora">${faixa}</span>
        <div class="slot-corpo">
          <span><b>Bloqueado</b> · ${esc(b.motivo)}</span>
          <span class="acoes slot-acoes"><button type="button" class="btn btn-peq" data-acao="desbloquear" data-id="${b.id}">Desbloquear</button></span>
        </div>
      </li>`;
  }

  if (velho) {
    return `<li class="slot slot-passado"><span class="slot-hora">${faixa}</span><div class="slot-corpo"><span class="nota">Horário encerrado</span></div></li>`;
  }

  return `
    <li class="slot slot-livre">
      <span class="slot-hora">${faixa}</span>
      <div class="slot-corpo">
        <span class="nota">Livre · até ${s.fim.replace(':', 'h')}</span>
        <span class="acoes slot-acoes">
          <button type="button" class="btn btn-peq" data-acao="agendar" ${ds}>Agendar</button>
          <button type="button" class="btn btn-peq" data-acao="bloquear-slot" ${ds}>Bloquear</button>
        </span>
      </div>
    </li>`;
}

async function acao(tipo, d) {
  const a = d.id ? [...atendimentos, ...pendentes].find((x) => String(x.id) === d.id) : null;
  if (tipo === 'agendar') return abrirAgendar({ data: d.data, inicio: d.inicio, fim: d.fim, publico: d.publico });
  if (tipo === 'bloquear-slot') return abrirBloquear({ de: d.data, ate: d.data, inicio: d.inicio, fim: d.fim });

  if (tipo === 'avisar' && a) {
    window.open(linkWhatsApp(a.telefone, textoAgendado(a)), '_blank', 'noopener');
    return;
  }
  if (tipo === 'liberar' && a) {
    const { error } = await sb.rpc('liberar_atendimento', { p_id: a.id });
    if (error) return aviso('erro', limparErro(error));
    a.status = 'agendado';
    aviso('ok', `Atendimento de ${a.nome} liberado.`, linkAvisar(a, textoAgendado(a)));
    return carregarSemana();
  }
  if (tipo === 'confirmar' && a) {
    const { error } = await sb.from('atendimentos').update({ status: 'agendado' }).eq('id', a.id);
    if (error) return aviso('erro', limparErro(error));
    a.status = 'agendado';
    aviso('ok', `Atendimento de ${a.nome} confirmado.`, linkAvisar(a, textoAgendado(a)));
    return carregarSemana();
  }
  if (tipo === 'recusar' && a) {
    if (!confirm(`Recusar o pedido de ${a.nome} (${dataCurta(a.data)}, ${hm(a.inicio)})? O horário fica livre.`)) return;
    const { error } = await sb.from('atendimentos').update({ status: 'cancelado' }).eq('id', a.id);
    if (error) return aviso('erro', limparErro(error));
    const texto = `Olá, ${primeiroNome(a.nome)}! Infelizmente não será possível o Direcionamento Espiritual com o Pároco da Paróquia São José em ${dataLonga(a.data).toLowerCase()}, às ${hora(hm(a.inicio) + ':00')}. Por favor, escolha outro horário no site ou fale com a secretaria.`;
    aviso('ok', `Pedido de ${a.nome} recusado.`, linkAvisar(a, texto));
    return carregarSemana();
  }
  if (tipo === 'realizado' && a) {
    const { error } = await sb.from('atendimentos').update({ status: 'realizado' }).eq('id', a.id);
    if (error) return aviso('erro', limparErro(error));
    aviso('ok', `Atendimento de ${a.nome} marcado como realizado.`);
    return carregarSemana();
  }
  if (tipo === 'excluir' && a) {
    if (!confirm(`Excluir o atendimento de ${a.nome} (${dataCurta(a.data)}, ${hm(a.inicio)})? O horário fica livre.`)) return;
    const { error } = await sb.from('atendimentos').delete().eq('id', a.id);
    if (error) return aviso('erro', limparErro(error));
    const texto = `Olá, ${primeiroNome(a.nome)}! O atendimento com o Pároco da Paróquia São José marcado para ${dataLonga(a.data).toLowerCase()}, às ${hora(hm(a.inicio) + ':00')}, foi cancelado. Por favor, fale com a secretaria para remarcar.`;
    aviso('ok', `Atendimento de ${a.nome} excluído.`, linkAvisar(a, texto));
    return carregarSemana();
  }
  if (tipo === 'desbloquear') {
    const b = bloqueios.find((x) => String(x.id) === d.id);
    const periodo = b.data_inicio === b.data_fim ? dataCurta(b.data_inicio) : `${dataCurta(b.data_inicio)} a ${dataCurta(b.data_fim)}`;
    const horas = b.inicio ? `, das ${hm(b.inicio)} às ${hm(b.fim)}` : ', dia todo';
    if (!confirm(`Remover o bloqueio "${b.motivo}" (${periodo}${horas})?`)) return;
    const { error } = await sb.from('atend_bloqueios').delete().eq('id', b.id);
    if (error) return aviso('erro', limparErro(error));
    aviso('ok', 'Bloqueio removido.');
    return carregarSemana();
  }
}

// ---------------------------------------------------------------- agendar
function abrirAgendar(slot) {
  slotAtual = slot;
  const f = $('f-agendar');
  f.reset();
  erroEm('ag-erro', '');
  $('ag-quando').textContent = `${dataLonga(slot.data)}, ${faixaHora(slot.inicio, slot.fim)} · ${PUBLICO[slot.publico]}`;
  const opcoes = slot.publico === 'enfermos'
    ? [['enfermo', 'Enfermo (atendimento no endereço informado)']]
    : [['paroquiano', 'Paroquiano'], ['externo', 'Não paroquiano (precisa de liberação da secretaria)']];
  $('ag-tipos').innerHTML = '<legend class="campo" style="padding:0;margin-bottom:8px">Quem será atendido</legend>'
    + opcoes.map(([v, t], i) => `<label class="marcar"><input type="radio" name="tipo" value="${v}" ${i === 0 ? 'checked' : ''}>${esc(t)}</label>`).join('');
  $('ag-tipos').querySelectorAll('input').forEach((r) => r.addEventListener('change', ajustarCampos));
  ajustarCampos();
  $('dlg-agendar').showModal();
  f.nome.focus();
}

function ajustarCampos() {
  const f = $('f-agendar');
  const tipo = f.querySelector('input[name="tipo"]:checked')?.value;
  const externo = tipo === 'externo';
  const enfermo = tipo === 'enfermo';
  $('ag-externo').hidden = !externo;
  $('ag-campo-endereco').hidden = !(externo || enfermo);
  $('ag-rotulo-end').textContent = enfermo ? 'Endereço residencial do enfermo' : 'Endereço';
  $('ag-campo-local').hidden = !enfermo;
  f.local.required = enfermo;
  f.endereco.required = externo || enfermo;
  f.paroquia.required = externo;
  f.paroco.required = externo;
  $('ag-rotulo-assunto').textContent = enfermo ? 'Observações (estado do enfermo, ponto de referência)' : 'Assunto (opcional)';
  const regra = externo && !ehSecretaria
    ? 'Pessoa de outra paróquia: o horário fica reservado, aguardando a liberação da secretaria.'
    : enfermo ? 'Atendimento a enfermo: o Pároco vai até o local informado.' : '';
  $('ag-regra').textContent = regra;
  $('ag-regra').hidden = !regra;
}

function ligarAgendar() {
  const f = $('f-agendar');
  mascaraTelefone(f.telefone);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = f.querySelector('input[name="tipo"]:checked')?.value;
    if (!f.nome.value.trim()) return erroEm('ag-erro', 'Informe o nome.');
    if (soDigitos(f.telefone.value).length < 10) return erroEm('ag-erro', 'Informe o telefone com DDD.');
    if ((tipo === 'externo' || tipo === 'enfermo') && !f.endereco.value.trim()) return erroEm('ag-erro', 'Informe o endereço.');
    if (tipo === 'enfermo' && !f.local.value.trim()) return erroEm('ag-erro', 'Informe o local onde o enfermo se encontra.');
    if (tipo === 'externo' && !f.paroquia.value.trim()) return erroEm('ag-erro', 'Informe a paróquia em que atua.');
    if (tipo === 'externo' && !f.paroco.value.trim()) return erroEm('ag-erro', 'Informe o nome do pároco responsável.');
    const bt = $('ag-salvar');
    bt.disabled = true;
    const { data: id, error } = await sb.rpc('agendar_atendimento', {
      p_data: slotAtual.data, p_inicio: slotAtual.inicio, p_fim: slotAtual.fim,
      p_nome: f.nome.value.trim(), p_telefone: f.telefone.value.trim(), p_tipo: tipo,
      p_assunto: f.assunto.value.trim() || null, p_endereco: f.endereco.value.trim() || null,
      p_paroquia: f.paroquia.value.trim() || null, p_paroco: f.paroco.value.trim() || null,
      p_local: tipo === 'enfermo' ? f.local.value.trim() : null,
    });
    bt.disabled = false;
    if (error) return erroEm('ag-erro', limparErro(error));
    $('dlg-agendar').close();
    await carregarSemana();
    const a = atendimentos.find((x) => x.id === id);
    if (a) {
      aviso('ok', a.status === 'pendente'
        ? `Horário reservado para ${a.nome}. Aguardando a liberação da secretaria.`
        : `Atendimento de ${a.nome} agendado.`, linkAvisar(a, textoAgendado(a)));
    }
  });
}

// ---------------------------------------------------------------- bloquear
function abrirBloquear(p = {}) {
  const f = $('f-bloquear');
  f.reset();
  erroEm('bl-erro', '');
  f.de.value = p.de || hojeISO();
  f.ate.value = p.ate || f.de.value;
  f.inicio.value = p.inicio || '';
  f.fim.value = p.fim || '';
  $('dlg-bloquear').showModal();
  f.motivo.focus();
}

function ligarBloquear() {
  const f = $('f-bloquear');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const de = f.de.value, ate = f.ate.value, ini = f.inicio.value, fim = f.fim.value, motivo = f.motivo.value.trim();
    if (!de || !ate || ate < de) return erroEm('bl-erro', 'Confira as datas: o fim não pode ser antes do início.');
    if ((ini && !fim) || (!ini && fim)) return erroEm('bl-erro', 'Preencha os dois horários ou deixe os dois vazios (dia todo).');
    if (ini && fim && fim <= ini) return erroEm('bl-erro', 'O horário final precisa ser depois do inicial.');
    if (!motivo) return erroEm('bl-erro', 'Informe o motivo.');
    const { error } = await sb.from('atend_bloqueios').insert({
      data_inicio: de, data_fim: ate, inicio: ini || null, fim: fim || null, motivo, criado_por: usuario.id,
    });
    if (error) return erroEm('bl-erro', limparErro(error));
    $('dlg-bloquear').close();
    await carregarSemana();
    // Atendimentos já marcados dentro do bloqueio
    const { data: afetados } = await sb.from('atendimentos').select('*')
      .gte('data', de).lte('data', ate).in('status', ['agendado', 'pendente', 'solicitado']);
    const conflitos = (afetados || []).filter((a) => !ini || (hm(a.inicio) < fim && hm(a.fim) > ini));
    if (conflitos.length) {
      aviso('info', `Bloqueio registrado. Atenção: ${conflitos.length === 1 ? 'há 1 atendimento marcado' : `há ${conflitos.length} atendimentos marcados`} nesse período, que continuam na agenda:`,
        conflitos.map((a) => `<br>• ${esc(dataCurta(a.data))} ${esc(hm(a.inicio))} — ${esc(a.nome)} · ${linkAvisar(a,
          `Olá, ${primeiroNome(a.nome)}! O Pároco da Paróquia São José não poderá atender em ${dataLonga(a.data).toLowerCase()}, às ${hora(hm(a.inicio) + ':00')} (${motivo}). Por favor, fale com a secretaria para remarcar.`)}`).join(''));
    } else {
      aviso('ok', 'Bloqueio registrado.');
    }
  });
}

// ---------------------------------------------------------------- horários
let linhasHorario = [];

function abrirHorarios() {
  linhasHorario = horarios.map((h) => ({ ...h, inicio: hm(h.inicio), fim: hm(h.fim) }));
  erroEm('hr-erro', '');
  desenharHorarios();
  $('dlg-horarios').showModal();
}

function desenharHorarios() {
  const opDia = (v) => DIAS_LONGOS.map((n, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>${n}</option>`).join('');
  $('hr-linhas').innerHTML = linhasHorario.map((h, i) => h.remover ? '' : `
    <tr data-i="${i}">
      <td><select data-c="dia_semana" aria-label="Dia">${opDia(Number(h.dia_semana))}</select></td>
      <td><input type="time" data-c="inicio" value="${esc(h.inicio)}" aria-label="Das"></td>
      <td><input type="time" data-c="fim" value="${esc(h.fim)}" aria-label="Às"></td>
      <td><select data-c="duracao_min" aria-label="Duração">${[15, 20, 30, 40, 45, 60, 90].map((m) => `<option value="${m}" ${m === Number(h.duracao_min) ? 'selected' : ''}>${m} min</option>`).join('')}</select></td>
      <td><select data-c="publico" aria-label="Para">${Object.entries(PUBLICO).map(([v, t]) => `<option value="${v}" ${v === h.publico ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="checkbox" data-c="ativo" ${h.ativo ? 'checked' : ''} aria-label="Ativo"></td>
      <td><button type="button" class="btn btn-perigo btn-peq" data-rem="${i}">Remover</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="nota">Nenhum horário. Use "Adicionar horário".</td></tr>';

  $('hr-linhas').querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
    const h = linhasHorario[Number(el.closest('tr').dataset.i)];
    const c = el.dataset.c;
    h[c] = c === 'ativo' ? el.checked : (c === 'dia_semana' || c === 'duracao_min') ? Number(el.value) : el.value;
  }));
  $('hr-linhas').querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => {
    linhasHorario[Number(b.dataset.rem)].remover = true;
    desenharHorarios();
  }));
}

function ligarHorarios() {
  $('hr-novo').addEventListener('click', () => {
    linhasHorario.push({ dia_semana: 2, inicio: '16:00', fim: '18:00', duracao_min: 30, publico: 'paroquianos', ativo: true });
    desenharHorarios();
  });
  $('f-horarios').addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const h of linhasHorario.filter((x) => !x.remover)) {
      if (!h.inicio || !h.fim || h.fim <= h.inicio) return erroEm('hr-erro', `Confira os horários de ${DIAS_LONGOS[h.dia_semana]}: o fim precisa ser depois do início.`);
    }
    const campos = (h) => ({ dia_semana: h.dia_semana, inicio: h.inicio, fim: h.fim, duracao_min: h.duracao_min, publico: h.publico, ativo: !!h.ativo });
    for (const h of linhasHorario) {
      let r;
      if (h.remover && h.id) r = await sb.from('atend_horarios').delete().eq('id', h.id);
      else if (!h.remover && h.id) r = await sb.from('atend_horarios').update(campos(h)).eq('id', h.id);
      else if (!h.remover) r = await sb.from('atend_horarios').insert(campos(h));
      if (r?.error) return erroEm('hr-erro', limparErro(r.error));
    }
    $('dlg-horarios').close();
    await carregarHorarios();
    await carregarSemana();
    aviso('ok', 'Horários de atendimento salvos.');
  });
}

// ---------------------------------------------------------------- início
let ligado = false;

// Abre a agenda dentro da Área de Gestão (aba "Direcionamento Espiritual")
export async function abrirAgendaParoco({ user, secretaria }) {
  usuario = user;
  ehSecretaria = !!secretaria;
  if (!ligado) {
    ligado = true;
    ligarAgendar();
    ligarBloquear();
    ligarHorarios();
    document.querySelectorAll('dialog[id^="at-"] [data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $('sem-ant').addEventListener('click', () => { inicioMes = outroMes(inicioMes, -1); carregarSemana(); });
    $('sem-prox').addEventListener('click', () => { inicioMes = outroMes(inicioMes, 1); carregarSemana(); });
    $('sem-hoje').addEventListener('click', () => { inicioMes = primeiroDoMes(hojeISO()); carregarSemana(); });
    $('bt-bloquear').addEventListener('click', () => abrirBloquear());
    $('bt-horarios').addEventListener('click', abrirHorarios);
    await carregarHorarios();
    // Se os atendimentos deste mês já passaram, abre direto o próximo
    let semFuturo = true;
    for (let d = hojeISO(); d <= ultimoDoMes(inicioMes); d = somaDias(d, 1)) {
      if (slotsDoDia(d).some((x) => !passou(x.data, x.fim))) { semFuturo = false; break; }
    }
    if (semFuturo && horarios.some((h) => h.ativo)) inicioMes = outroMes(inicioMes, 1);
  }
  await carregarSemana();
}
