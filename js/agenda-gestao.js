// Aba "Agenda" da Área de Gestão (só a secretaria): calendário mensal com os compromissos
// da secretaria, os dias bloqueados (só registro, não impede reservas) e as reservas de
// salas, barracas e Direcionamento (confirmadas e pendentes, só para consulta).
import { sb, limparErro } from './api.js';
import { esc, hojeISO, somaDias, dataLonga, diaSemana, MESES } from './util.js';
import { carregarDiasAgenda, periodoEvento, hhmm } from './agenda-dados.js';

const $ = (id) => document.getElementById(id);
const DIAS_CAB = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const nomeMes = (m) => MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

let usuario = null;
let ligado = false;
let ano = Number(hojeISO().slice(0, 4));
let mes = Number(hojeISO().slice(5, 7));
let dias = new Map();
let diaAberto = null;
let eventoEditando = null;

function aviso(tipo, texto) {
  const el = $('ag-msg');
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  el.hidden = false;
}

export async function carregarAgenda({ user }) {
  usuario = user;
  ligar();
  $('ag-msg').hidden = true;
  await desenharMes();
}

// ---------------------------------------------------------------- calendário do mês
function gradeDoMes() {
  const pri = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ini = somaDias(pri, -diaSemana(pri));
  const ultDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const ult = `${ano}-${String(mes).padStart(2, '0')}-${String(ultDia).padStart(2, '0')}`;
  const fim = somaDias(ult, 6 - diaSemana(ult));
  return { ini, fim };
}

async function desenharMes() {
  $('ag-titulo').textContent = `${nomeMes(mes)} ${ano}`;
  const { ini, fim } = gradeDoMes();
  $('ag-grade').innerHTML = '<div class="carregando">Carregando a agenda…</div>';
  try {
    dias = await carregarDiasAgenda(ini, fim);
  } catch (e) {
    $('ag-grade').innerHTML = '';
    throw new Error(`Não foi possível carregar a agenda. Verifique se o arquivo atualizacao-agenda.sql foi executado no Supabase. ${e.message || ''}`);
  }
  const hoje = hojeISO();
  const celulas = [];
  for (let d = ini; d <= fim; d = somaDias(d, 1)) {
    const info = dias.get(d);
    const fora = Number(d.slice(5, 7)) !== mes;
    const bloq = info?.bloqueios?.[0];
    const comps = info?.compromissos || [];
    const marcas = [];
    if (info?.salas.length) marcas.push(`<span class="ag-marca ag-c-sala">${plural(info.salas.length, 'sala', 'salas')}</span>`);
    if (info?.barracas.length) marcas.push(`<span class="ag-marca ag-c-barr">${plural(info.barracas.length, 'barraca', 'barracas')}</span>`);
    if (info?.direcionamento.length) marcas.push(`<span class="ag-marca ag-c-dir">${plural(info.direcionamento.length, 'direc.', 'direc.')}</span>`);
    const pend = info ? [...info.salas, ...info.barracas, ...info.direcionamento].filter((x) => x.aguardando).length : 0;
    const total = comps.length + (info ? info.salas.length + info.barracas.length + info.direcionamento.length : 0);
    const rotulo = `${dataLonga(d)}${bloq ? `, dia bloqueado: ${bloq.titulo}` : ''}${total ? `, ${plural(total, 'item', 'itens')}` : ''}`;
    celulas.push(`
      <button type="button" class="ag-dia-cel${fora ? ' fora' : ''}${d === hoje ? ' hoje' : ''}${bloq ? ' bloq' : ''}" data-dia="${d}" aria-label="${esc(rotulo)}">
        <span class="ag-num">${Number(d.slice(8))}</span>
        ${bloq ? `<span class="ag-bloq-tx">${esc(bloq.titulo)}</span>` : ''}
        ${comps.slice(0, 2).map((e) => `<span class="ag-comp"><b>${e.dia_inteiro ? '' : esc(hhmm(e.hora_inicio))}</b> ${esc(e.titulo)}</span>`).join('')}
        ${comps.length > 2 ? `<span class="ag-mais">+${comps.length - 2} compromisso${comps.length - 2 > 1 ? 's' : ''}</span>` : ''}
        ${marcas.length ? `<span class="ag-marcas">${marcas.join('')}</span>` : ''}
        ${pend ? `<span class="ag-pend">${pend} aguardando</span>` : ''}
        <span class="ag-pontos" aria-hidden="true">${comps.length ? '<i class="ag-c-comp"></i>' : ''}${info?.salas.length ? '<i class="ag-c-sala"></i>' : ''}${info?.barracas.length ? '<i class="ag-c-barr"></i>' : ''}${info?.direcionamento.length ? '<i class="ag-c-dir"></i>' : ''}</span>
      </button>`);
  }
  $('ag-grade').innerHTML = DIAS_CAB.map((n) => `<span class="ag-cab">${n}</span>`).join('') + celulas.join('');
  $('ag-grade').querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => abrirDia(b.dataset.dia)));
}

// ---------------------------------------------------------------- janela do dia
const etqAguardando = (x) => (x.aguardando ? ' <span class="etq etq-pend">aguardando</span>' : '');

function abrirDia(d) {
  diaAberto = d;
  const info = dias.get(d) || { bloqueios: [], compromissos: [], salas: [], barracas: [], direcionamento: [] };
  $('ag-dia-titulo').textContent = dataLonga(d);
  const secoes = [];

  if (info.bloqueios.length) {
    secoes.push(`<section class="ag-sec"><h3><i class="ag-c-bloq"></i>Dia bloqueado</h3>${info.bloqueios.map((b) => `
      <div class="ag-item">
        <div><b>${esc(b.titulo)}</b>${b.data_fim && b.data_fim !== b.data ? `<br><span class="nota">De ${esc(b.data.split('-').reverse().join('/'))} até ${esc(b.data_fim.split('-').reverse().join('/'))}</span>` : ''}${b.resumo ? `<p class="ag-resumo">${esc(b.resumo)}</p>` : ''}</div>
        <button type="button" class="btn btn-sec btn-peq" data-editar="${b.id}">Editar</button>
      </div>`).join('')}</section>`);
  }

  secoes.push(`<section class="ag-sec"><h3><i class="ag-c-comp"></i>Compromissos</h3>${info.compromissos.length ? info.compromissos.map((e) => `
    <div class="ag-item">
      <div><span class="ag-hora">${esc(periodoEvento(e))}</span><br><b>${esc(e.titulo)}</b>${e.resumo ? `<p class="ag-resumo">${esc(e.resumo)}</p>` : ''}</div>
      <button type="button" class="btn btn-sec btn-peq" data-editar="${e.id}">Editar</button>
    </div>`).join('') : '<p class="nota" style="margin:0">Nenhum compromisso neste dia.</p>'}</section>`);

  if (info.salas.length) {
    secoes.push(`<section class="ag-sec"><h3><i class="ag-c-sala"></i>Salas</h3>${info.salas.map((s) => `
      <div class="ag-item"><div><b>${esc(s.sala)}</b> · ${esc(s.turnos.join(', '))}${etqAguardando(s)}<br><span class="nota">${esc(s.grupo)}</span></div>
      <a class="btn btn-sec btn-peq" href="comprovante.html?c=${encodeURIComponent(s.codigo)}" target="_blank" rel="noopener">${esc(s.codigo)}</a></div>`).join('')}</section>`);
  }
  if (info.barracas.length) {
    secoes.push(`<section class="ag-sec"><h3><i class="ag-c-barr"></i>Barracas</h3>${info.barracas.map((b) => `
      <div class="ag-item"><div><b>Barraca</b> · ${esc(b.turnos.join(', '))}${etqAguardando(b)}<br><span class="nota">${esc(b.grupo)}</span></div>
      <a class="btn btn-sec btn-peq" href="comprovante.html?c=${encodeURIComponent(b.codigo)}" target="_blank" rel="noopener">${esc(b.codigo)}</a></div>`).join('')}</section>`);
  }
  if (info.direcionamento.length) {
    secoes.push(`<section class="ag-sec"><h3><i class="ag-c-dir"></i>Direcionamento Espiritual</h3>${info.direcionamento.map((a) => `
      <div class="ag-item"><div><b>${esc(hhmm(a.inicio))} às ${esc(hhmm(a.fim))}</b> · ${esc(a.nome)}${etqAguardando(a)}<br><span class="nota">${a.tipo === 'enfermo' ? 'Enfermo' : a.tipo === 'externo' ? 'Não paroquiano' : 'Paroquiano'}</span></div></div>`).join('')}</section>`);
  }

  $('ag-dia-conteudo').innerHTML = secoes.join('');
  $('ag-dia-conteudo').querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
    const todos = [...info.bloqueios, ...info.compromissos];
    abrirForm(todos.find((x) => String(x.id) === b.dataset.editar));
  }));
  $('ag-dia-bloquear').hidden = info.bloqueios.length > 0;
  $('ag-dia').hidden = false;
  $('f-agenda').hidden = true;
  if (!$('dlg-agenda').open) $('dlg-agenda').showModal();
}

// ---------------------------------------------------------------- formulário do compromisso
function ajustarForm() {
  const f = $('f-agenda');
  const bloqueio = f.tipo.value === 'bloqueio';
  $('fa-rotulo-titulo').innerHTML = `${bloqueio ? 'Motivo' : 'Evento'} <span class="obrig" aria-hidden="true">*</span>`;
  f.titulo.placeholder = bloqueio ? 'Ex.: Feriado de Finados · Sem expediente' : 'Ex.: Reunião do Conselho Pastoral';
  $('fa-campo-ate').hidden = !bloqueio;
  $('fa-campo-inteiro').hidden = bloqueio;
  $('fa-horas').hidden = bloqueio || f.dia_inteiro.checked;
}

function abrirForm(evento, tipo = 'compromisso', data = diaAberto || hojeISO()) {
  eventoEditando = evento || null;
  const f = $('f-agenda');
  f.reset();
  const e = evento || { tipo, data, dia_inteiro: tipo === 'bloqueio' };
  f.tipo.value = e.tipo;
  f.titulo.value = e.titulo || '';
  f.data.value = e.data;
  f.data_fim.value = e.data_fim && e.data_fim !== e.data ? e.data_fim : '';
  f.dia_inteiro.checked = !!e.dia_inteiro;
  f.hora_inicio.value = e.hora_inicio ? String(e.hora_inicio).slice(0, 5) : '';
  f.hora_fim.value = e.hora_fim ? String(e.hora_fim).slice(0, 5) : '';
  f.resumo.value = e.resumo || '';
  $('fa-titulo').textContent = evento ? (e.tipo === 'bloqueio' ? 'Editar dia bloqueado' : 'Editar compromisso') : (tipo === 'bloqueio' ? 'Bloquear dia' : 'Novo compromisso');
  $('fa-excluir').hidden = !evento;
  $('fa-msg').hidden = true;
  ajustarForm();
  $('ag-dia').hidden = true;
  f.hidden = false;
  if (!$('dlg-agenda').open) $('dlg-agenda').showModal();
  f.titulo.focus();
}

function erroForm(texto) {
  const m = $('fa-msg');
  m.className = 'aviso aviso-erro';
  m.textContent = texto;
  m.hidden = false;
}

async function salvar(ev) {
  ev.preventDefault();
  const f = $('f-agenda');
  const bloqueio = f.tipo.value === 'bloqueio';
  const titulo = f.titulo.value.trim();
  if (!titulo) return erroForm(bloqueio ? 'Informe o motivo do bloqueio.' : 'Informe o evento.');
  if (!f.data.value) return erroForm('Informe a data.');
  const inteiro = bloqueio || f.dia_inteiro.checked;
  if (!inteiro && !f.hora_inicio.value) return erroForm('Informe o horário de início ou marque "Dia inteiro".');
  if (!inteiro && f.hora_fim.value && f.hora_fim.value <= f.hora_inicio.value) return erroForm('O horário de fim deve ser depois do início.');
  if (bloqueio && f.data_fim.value && f.data_fim.value < f.data.value) return erroForm('A data final deve ser igual ou depois da data inicial.');
  const dados = {
    tipo: f.tipo.value,
    titulo,
    data: f.data.value,
    data_fim: bloqueio && f.data_fim.value ? f.data_fim.value : null,
    dia_inteiro: inteiro,
    hora_inicio: inteiro ? null : f.hora_inicio.value,
    hora_fim: inteiro || !f.hora_fim.value ? null : f.hora_fim.value,
    resumo: f.resumo.value.trim() || null,
  };
  $('fa-salvar').disabled = true;
  const r = eventoEditando
    ? await sb.from('agenda_eventos').update({ ...dados, atualizado_em: new Date().toISOString() }).eq('id', eventoEditando.id)
    : await sb.from('agenda_eventos').insert({ ...dados, criado_por: usuario?.id || null });
  $('fa-salvar').disabled = false;
  if (r.error) return erroForm(limparErro(r.error));
  await voltarAoDia(dados.data);
}

async function excluir() {
  if (!eventoEditando) return;
  if (!confirm(`Excluir "${eventoEditando.titulo}" da agenda? Esta ação não pode ser desfeita.`)) return;
  const { error } = await sb.from('agenda_eventos').delete().eq('id', eventoEditando.id);
  if (error) return erroForm(limparErro(error));
  await voltarAoDia(eventoEditando.data);
}

async function voltarAoDia(d) {
  const [a, m] = d.split('-').map(Number);
  if (a !== ano || m !== mes) { ano = a; mes = m; }
  try { await desenharMes(); } catch (e) { aviso('erro', e.message); }
  abrirDia(d);
}

// ---------------------------------------------------------------- eventos (uma vez)
function mudarMes(delta) {
  mes += delta;
  if (mes < 1) { mes = 12; ano -= 1; }
  if (mes > 12) { mes = 1; ano += 1; }
  desenharMes().catch((e) => aviso('erro', e.message));
}

function ligar() {
  if (ligado) return;
  ligado = true;
  $('ag-ant').addEventListener('click', () => mudarMes(-1));
  $('ag-prox').addEventListener('click', () => mudarMes(1));
  $('ag-hoje').addEventListener('click', () => {
    ano = Number(hojeISO().slice(0, 4)); mes = Number(hojeISO().slice(5, 7));
    desenharMes().catch((e) => aviso('erro', e.message));
  });
  $('ag-novo').addEventListener('click', () => { diaAberto = null; abrirForm(null, 'compromisso', hojeISO()); });
  $('ag-dia-novo').addEventListener('click', () => abrirForm(null, 'compromisso', diaAberto));
  $('ag-dia-bloquear').addEventListener('click', () => abrirForm(null, 'bloqueio', diaAberto));
  $('ag-fechar').addEventListener('click', () => $('dlg-agenda').close());
  $('fa-voltar').addEventListener('click', () => (diaAberto ? abrirDia(diaAberto) : $('dlg-agenda').close()));
  $('fa-excluir').addEventListener('click', excluir);
  const f = $('f-agenda');
  f.addEventListener('submit', salvar);
  f.addEventListener('change', (e) => { if (['tipo', 'dia_inteiro'].includes(e.target.name)) ajustarForm(); });
  // Clique fora da janela fecha
  $('dlg-agenda').addEventListener('click', (e) => { if (e.target === $('dlg-agenda')) $('dlg-agenda').close(); });
}
