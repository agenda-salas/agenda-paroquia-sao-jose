// Gestão da secretaria: login próprio e todas as tarefas numa página só
import { sb, limparErro, nomeSala, carregarTurnos } from './api.js';
import { esc, hojeISO, somaDias, dataLonga, dataCurta, faixa, linkWhatsApp, primeiroNome, DIAS_CURTOS, diaSemana } from './util.js';
import { linkComprovante } from './comprovante.js';

const $ = (id) => document.getElementById(id);
const ABAS = ['aprovacoes', 'reservas', 'bloqueios', 'salas', 'coordenadores', 'config'];
const ATIVOS = ['pendente', 'confirmada'];
const SITUACAO = {
  confirmada: ['Confirmada', 'etq-ok'], pendente: ['Pendente', 'etq-pend'], recusada: ['Recusada', 'etq-res'],
  cancelada: ['Cancelada', 'etq-bloq'], expirada: ['Expirada', 'etq-bloq'], realizada: ['Realizada', 'etq-azul'],
  nao_compareceu: ['Não compareceu', 'etq-bloq'],
};

let usuario = null;
let salas = [];
let turnos = [];
let recuperandoSenha = false;

// ---------------------------------------------------------------- utilidades
const salaPorId = (id) => salas.find((s) => s.id === id);
const turnoPorId = (id) => turnos.find((t) => t.id === id);

function aviso(tipo, texto, extraHtml = '') {
  const el = $('msg');
  el.className = `aviso aviso-${tipo}`;
  el.innerHTML = `<span>${esc(texto)}${extraHtml ? ' ' + extraHtml : ''}</span>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function limparAviso() { $('msg').hidden = true; }

function dataComDia(iso) { return `${DIAS_CURTOS[diaSemana(iso)]} ${dataCurta(iso)}`; }

// Junta as linhas de um mesmo pedido (mesmo código, um turno por linha)
function agrupar(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const p = m.get(l.codigo) || { ...l, listaTurnos: [] };
    const t = turnoPorId(l.turno_id);
    if (t) p.listaTurnos.push(t);
    m.set(l.codigo, p);
  }
  const lista = [...m.values()];
  lista.forEach((p) => p.listaTurnos.sort((a, b) => a.ordem - b.ordem));
  return lista.sort((a, b) => a.data.localeCompare(b.data) || ((a.listaTurnos[0]?.ordem || 0) - (b.listaTurnos[0]?.ordem || 0)));
}

function resumoPedido(p) {
  const sala = salaPorId(p.sala_id);
  return `${sala ? nomeSala(sala) : 'Sala'}, ${dataLonga(p.data)}, ${p.listaTurnos.map((t) => t.nome.toLowerCase()).join(' e ')}`;
}

function linkAvisar(p, texto, rotulo) {
  return `<a href="${linkWhatsApp(p.responsavel_telefone, texto)}" target="_blank" rel="noopener">${esc(rotulo || `Avisar ${primeiroNome(p.responsavel_nome)} no WhatsApp`)}</a>`;
}

// Grupo + dados de quem é de outra paróquia
function grupoHtml(p) {
  if (p.tipo !== 'externo') return esc(p.grupo);
  return `${esc(p.grupo)} <span class="etq etq-externo">Não paroquiano</span>
    <br><span class="nota">${esc(p.paroquia_origem || '')} · ${esc(p.paroco_responsavel || '')}</span>
    <br><span class="nota">${esc(p.endereco || '')}</span>`;
}

function contatoHtml(p) {
  return `<b>${esc(p.responsavel_nome || '—')}</b><br>
    <a href="${linkWhatsApp(p.responsavel_telefone, '')}" target="_blank" rel="noopener">${esc(p.responsavel_telefone || '')}</a>`;
}

// ---------------------------------------------------------------- telas e login
function mostrar(view) {
  ['v-login', 'v-negado', 'v-gestao'].forEach((v) => { $(v).hidden = v !== view; });
  $('conta').hidden = view !== 'v-gestao';
}

async function entrarComUsuario(user) {
  if (!user) { mostrar('v-login'); return; }
  const { data: admin, error } = await sb.rpc('is_admin');
  if (error) { mostrar('v-login'); mostrarLoginMsg('erro', limparErro(error)); return; }
  if (!admin) {
    $('negado-email').textContent = user.email;
    mostrar('v-negado');
    return;
  }
  usuario = user;
  $('avatar').textContent = (user.email || '?')[0].toUpperCase();
  $('usuario-nome').textContent = user.email;
  mostrar('v-gestao');

  const [{ data: s, error: e1 }, rt] = await Promise.all([
    sb.from('salas').select('*').order('ordem').order('numero'),
    carregarTurnos(),
  ]);
  if (e1) { aviso('erro', limparErro(e1)); return; }
  salas = s || [];
  turnos = rt.dados || [];
  preencherSelects();
  const inicial = location.hash.slice(1);
  abrirAba(ABAS.includes(inicial) ? inicial : 'aprovacoes');
  atualizarContador();
}

function mostrarLoginMsg(tipo, texto) {
  const el = $('login-msg');
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  el.hidden = false;
}

function ligarLogin() {
  $('f-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const bt = f.querySelector('[type=submit]');
    bt.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
    bt.disabled = false;
    if (error) return mostrarLoginMsg('erro', limparErro(error));
    $('login-msg').hidden = true;
    f.senha.value = '';
    entrarComUsuario(data.user);
  });

  $('esqueci').addEventListener('click', async () => {
    const email = $('f-login').email.value.trim();
    if (!email) return mostrarLoginMsg('erro', 'Digite o e-mail no campo acima e toque de novo em "Esqueci minha senha".');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return mostrarLoginMsg('erro', limparErro(error));
    mostrarLoginMsg('ok', 'Enviamos um link para criar uma nova senha. Confira o e-mail.');
  });

  $('f-nova').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await sb.auth.updateUser({ password: e.target.senha.value });
    if (error) return mostrarLoginMsg('erro', limparErro(error));
    recuperandoSenha = false;
    $('f-nova').hidden = true;
    $('f-login').hidden = false;
    history.replaceState(null, '', location.pathname);
    entrarComUsuario(data.user);
  });

  const sair = async () => {
    await sb.auth.signOut();
    usuario = null;
    history.replaceState(null, '', location.pathname);
    mostrar('v-login');
  };
  $('sair').addEventListener('click', sair);
  $('trocar-conta').addEventListener('click', sair);
}

// ---------------------------------------------------------------- abas
const CARREGAR = {
  aprovacoes: carregarAprovacoes,
  reservas: carregarReservas,
  bloqueios: carregarBloqueios,
  salas: carregarSalas,
  coordenadores: carregarCoordenadores,
  config: carregarConfig,
};

function abrirAba(nome) {
  history.replaceState(null, '', `#${nome}`);
  document.querySelectorAll('.abas-gestao [data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
  ABAS.forEach((a) => { $(`aba-${a}`).hidden = a !== nome; });
  limparAviso();
  CARREGAR[nome]().catch((e) => aviso('erro', limparErro(e)));
}

async function atualizarContador() {
  const { data } = await sb.from('reservas').select('codigo').eq('status', 'pendente');
  const n = new Set((data || []).map((x) => x.codigo)).size;
  const el = $('cont-aprov');
  el.textContent = n;
  el.hidden = n === 0;
}

function preencherSelects() {
  const opcoes = salas.filter((s) => s.ativa).map((s) => `<option value="${s.id}">${esc(nomeSala(s))}</option>`).join('');
  $('f-filtro').sala.innerHTML = '<option value="">Todas</option>' + opcoes;
  $('f-bloq').sala.innerHTML = '<option value="todas">Todas as salas</option>' + opcoes;
  $('bloq-turnos').innerHTML = turnos.map((t) =>
    `<label class="marcar"><input type="checkbox" name="turno" value="${t.codigo}">${esc(t.nome)}</label>`).join('');
}

// ---------------------------------------------------------------- aprovações
async function carregarAprovacoes() {
  await sb.rpc('expirar_pendentes');
  const { data, error } = await sb.from('reservas')
    .select('codigo, data, motivo, criado_em, grupo, responsavel_nome, responsavel_telefone, sala_id, turno_id, tipo, endereco, paroquia_origem, paroco_responsavel')
    .eq('status', 'pendente').order('data').order('criado_em');
  if (error) throw error;
  const pedidos = agrupar(data);
  $('aprov-resumo').textContent = pedidos.length === 1 ? '1 pedido aguardando' : `${pedidos.length} pedidos aguardando`;
  atualizarContador();
  if (!pedidos.length) { $('aprov-lista').innerHTML = '<div class="vazio">Nenhum pedido aguardando aprovação.</div>'; return; }

  $('aprov-lista').innerHTML = `<div class="grade-salas" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${pedidos.map((p) => {
    const sala = salaPorId(p.sala_id);
    return `
      <article class="cartao" style="display:flex;flex-direction:column;gap:8px;border-top:4px solid var(--dourado)" data-codigo="${esc(p.codigo)}">
        <div class="sala-topo"><span class="sala-nome">${esc(sala ? nomeSala(sala) : '')}</span><span class="etq etq-pend">${esc(p.codigo)}</span></div>
        <b>${esc(dataLonga(p.data))}</b>
        <span class="nota">${esc(p.listaTurnos.map((t) => `${t.nome} (${faixa(t)})`).join(', '))}</span>
        <span><b>${grupoHtml(p)}</b></span>
        <span class="nota">${esc(p.responsavel_nome)} · <a href="${linkWhatsApp(p.responsavel_telefone, '')}" target="_blank" rel="noopener">${esc(p.responsavel_telefone)}</a></span>
        ${p.motivo ? `<span class="nota">Motivo: ${esc(p.motivo)}</span>` : ''}
        <span class="nota" style="font-size:12px">Pedido em ${new Date(p.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <div class="acoes">
          <button type="button" class="btn" data-aprovar>Aprovar</button>
          <button type="button" class="btn btn-perigo" data-recusar>Recusar</button>
        </div>
        <div class="form" data-recusa hidden>
          <label class="campo">Motivo da recusa (aparece no comprovante)
            <input type="text" maxlength="200">
          </label>
          <button type="button" class="btn btn-perigo" data-confirmar-recusa>Confirmar recusa</button>
        </div>
      </article>`;
  }).join('')}</div>`;

  $('aprov-lista').querySelectorAll('[data-codigo]').forEach((card) => {
    const p = pedidos.find((x) => x.codigo === card.dataset.codigo);
    card.querySelector('[data-aprovar]').addEventListener('click', () => decidir(p, true));
    card.querySelector('[data-recusar]').addEventListener('click', () => {
      const r = card.querySelector('[data-recusa]');
      r.hidden = !r.hidden;
      if (!r.hidden) r.querySelector('input').focus();
    });
    card.querySelector('[data-confirmar-recusa]').addEventListener('click', () => {
      const motivo = card.querySelector('[data-recusa] input').value.trim();
      if (!motivo) return aviso('erro', 'Informe o motivo da recusa.');
      decidir(p, false, motivo);
    });
  });
}

async function decidir(p, aprovar, motivo) {
  const { error } = await sb.rpc('decidir_reserva', { p_codigo: p.codigo, p_aprovar: aprovar, p_motivo: motivo || null });
  if (error) return aviso('erro', limparErro(error));
  const nome = primeiroNome(p.responsavel_nome);
  const texto = aprovar
    ? `Olá, ${nome}! Sua reserva ${p.codigo} (${resumoPedido(p)}) foi APROVADA pela secretaria da Paróquia São José. Comprovante: ${linkComprovante(p.codigo)}`
    : `Olá, ${nome}! Sua reserva ${p.codigo} (${resumoPedido(p)}) não pôde ser aprovada. Motivo: ${motivo}. Em caso de dúvida, fale com a secretaria.`;
  aviso('ok', aprovar ? `Pedido ${p.codigo} aprovado.` : `Pedido ${p.codigo} recusado e turno liberado.`, linkAvisar(p, texto));
  await carregarAprovacoes();
}

// ---------------------------------------------------------------- reservas
let reservasCache = [];

async function carregarReservas() {
  const f = $('f-filtro');
  if (!f.de.value) f.de.value = hojeISO();
  if (!f.ate.value) f.ate.value = somaDias(hojeISO(), 15);
  let q = sb.from('reservas')
    .select('codigo, data, status, grupo, responsavel_nome, responsavel_telefone, sala_id, turno_id, motivo, tipo, endereco, paroquia_origem, paroco_responsavel')
    .gte('data', f.de.value).lte('data', f.ate.value).order('data').limit(2000);
  if (f.sala.value) q = q.eq('sala_id', Number(f.sala.value));
  if (f.situacao.value === 'ativas') q = q.in('status', ATIVOS);
  if (f.situacao.value === 'canceladas') q = q.in('status', ['cancelada', 'recusada', 'expirada']);
  if (f.tipo.value) q = q.eq('tipo', f.tipo.value);
  const { data, error } = await q;
  if (error) throw error;
  reservasCache = agrupar(data);
  desenharReservas();
}

function desenharReservas() {
  const busca = $('f-filtro').busca.value.trim().toLowerCase();
  const hoje = hojeISO();
  const lista = reservasCache.filter((p) => !busca ||
    [p.grupo, p.responsavel_nome, p.codigo].some((x) => (x || '').toLowerCase().includes(busca)));
  $('res-resumo').textContent = lista.length === 1 ? '1 reserva' : `${lista.length} reservas`;
  $('res-linhas').innerHTML = lista.map((p) => {
    const sala = salaPorId(p.sala_id);
    const [txt, cls] = SITUACAO[p.status] || [p.status, 'etq-bloq'];
    const podeCancelar = ATIVOS.includes(p.status) && p.data >= hoje;
    const podeFalta = p.status === 'confirmada' && p.data <= hoje;
    return `
      <tr data-codigo="${esc(p.codigo)}">
        <td><b>${esc(dataComDia(p.data))}</b><br><span class="nota">${esc(p.codigo)}</span></td>
        <td>${esc(p.listaTurnos.map((t) => t.nome).join(', '))}</td>
        <td>${esc(sala ? nomeSala(sala) : '')}</td>
        <td>${grupoHtml(p)}</td>
        <td>${contatoHtml(p)}</td>
        <td><span class="etq ${cls}">${txt}</span></td>
        <td><span class="acoes-cel">
          <a class="btn btn-sec btn-peq" href="${linkComprovante(p.codigo)}" target="_blank" rel="noopener">Comprovante</a>
          ${podeFalta ? '<button type="button" class="btn btn-sec btn-peq" data-falta>Não compareceu</button>' : ''}
          ${podeCancelar ? '<button type="button" class="btn btn-perigo btn-peq" data-cancelar>Cancelar</button>' : ''}
          <button type="button" class="btn btn-perigo btn-peq" data-excluir title="Apagar definitivamente">Excluir</button>
        </span></td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" class="nota">Nenhuma reserva no período.</td></tr>';

  $('res-linhas').querySelectorAll('tr[data-codigo]').forEach((tr) => {
    const p = reservasCache.find((x) => x.codigo === tr.dataset.codigo);
    tr.querySelector('[data-cancelar]')?.addEventListener('click', () => cancelar(p, carregarReservas));
    tr.querySelector('[data-falta]')?.addEventListener('click', () => marcarFalta(p));
    tr.querySelector('[data-excluir]')?.addEventListener('click', () => excluirReserva(p));
  });
}

async function excluirReserva(p) {
  const ok = confirm(`EXCLUIR DEFINITIVAMENTE a reserva ${p.codigo} (${p.grupo})?\n\n`
    + 'Ela some do histórico e o link do comprovante deixa de funcionar. Não é possível desfazer.\n\n'
    + 'Para apenas liberar o turno, use "Cancelar".');
  if (!ok) return;
  const { data, error } = await sb.from('reservas').delete().eq('codigo', p.codigo).select('id');
  if (error) return aviso('erro', limparErro(error));
  if (!data?.length) return aviso('erro', 'A reserva não foi encontrada ou você não tem permissão para excluí-la.');
  aviso('ok', `Reserva ${p.codigo} excluída.`);
  await carregarReservas();
  atualizarContador();
}

async function cancelar(p, depois) {
  if (!confirm(`Cancelar a reserva ${p.codigo} (${p.grupo})? O turno fica livre para outros grupos.`)) return;
  const { data, error } = await sb.from('reservas').update({ status: 'cancelada' })
    .eq('codigo', p.codigo).in('status', ATIVOS).select('id');
  if (error) return aviso('erro', limparErro(error));
  if (!data?.length) return aviso('erro', 'Esta reserva já não estava ativa.');
  const texto = `Olá, ${primeiroNome(p.responsavel_nome)}! Sua reserva ${p.codigo} (${resumoPedido(p)}) foi CANCELADA pela secretaria da Paróquia São José. Em caso de dúvida, fale com a secretaria.`;
  aviso('ok', `Reserva ${p.codigo} cancelada.`, linkAvisar(p, texto));
  await depois();
  atualizarContador();
}

async function marcarFalta(p) {
  if (!confirm(`Registrar que ${p.grupo} não compareceu (${p.codigo})?`)) return;
  const { error } = await sb.from('reservas').update({ status: 'nao_compareceu' }).eq('codigo', p.codigo).eq('status', 'confirmada');
  if (error) return aviso('erro', limparErro(error));
  aviso('ok', `Registrado: ${p.grupo} não compareceu.`);
  carregarReservas();
}

// ---------------------------------------------------------------- bloqueios
async function carregarBloqueios() {
  const f = $('f-bloq');
  if (!f.de.value) f.de.value = hojeISO();
  if (!f.ate.value) f.ate.value = hojeISO();
  const { data, error } = await sb.from('bloqueios').select('*').gte('data_fim', hojeISO()).order('data_inicio');
  if (error) throw error;

  // Bloqueios criados juntos para "todas as salas" aparecem numa linha só
  const grupos = new Map();
  for (const b of data) {
    const chave = [b.data_inicio, b.data_fim, (b.turnos || []).join(','), b.motivo, b.criado_em.slice(0, 16)].join('|');
    const g = grupos.get(chave) || { ...b, ids: [], salasIds: [] };
    g.ids.push(b.id);
    g.salasIds.push(b.sala_id);
    grupos.set(chave, g);
  }
  const ativas = salas.filter((s) => s.ativa).length;
  const linhas = [...grupos.values()];
  $('bloq-linhas').innerHTML = linhas.map((g, i) => {
    const nomeSalas = g.salasIds.length > 1 && g.salasIds.length >= ativas ? 'Todas as salas'
      : g.salasIds.map((id) => { const s = salaPorId(id); return s ? nomeSala(s) : ''; }).join(', ');
    const periodo = g.data_inicio === g.data_fim ? dataComDia(g.data_inicio) : `${dataCurta(g.data_inicio)} a ${dataCurta(g.data_fim)}`;
    const nomesTurnos = g.turnos && g.turnos.length
      ? g.turnos.map((c) => turnos.find((t) => t.codigo === c)?.nome || c).join(', ') : 'Dia todo';
    return `<tr>
      <td><b>${esc(nomeSalas)}</b></td><td>${esc(periodo)}</td><td>${esc(nomesTurnos)}</td><td>${esc(g.motivo)}</td>
      <td><span class="acoes-cel"><button type="button" class="btn btn-perigo btn-peq" data-remover="${i}">Remover</button></span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="nota">Nenhum bloqueio atual ou futuro.</td></tr>';

  $('bloq-linhas').querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    const g = linhas[Number(b.dataset.remover)];
    if (!confirm(`Remover o bloqueio "${g.motivo}"? As salas voltam a aceitar reservas nesse período.`)) return;
    const { error: e } = await sb.from('bloqueios').delete().in('id', g.ids);
    if (e) return aviso('erro', limparErro(e));
    aviso('ok', 'Bloqueio removido.');
    carregarBloqueios();
  }));
}

function ligarBloqueios() {
  $('f-bloq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const de = f.de.value, ate = f.ate.value, motivo = f.motivo.value.trim();
    if (!de || !ate || ate < de) return aviso('erro', 'Confira as datas: o fim não pode ser antes do início.');
    if (!motivo) return aviso('erro', 'Informe o motivo do bloqueio.');
    const marcados = [...f.querySelectorAll('input[name="turno"]:checked')].map((i) => i.value);
    const ids = f.sala.value === 'todas' ? salas.filter((s) => s.ativa).map((s) => s.id) : [Number(f.sala.value)];
    const linhas = ids.map((id) => ({
      sala_id: id, data_inicio: de, data_fim: ate, turnos: marcados.length ? marcados : null, motivo, criado_por: usuario.id,
    }));
    const bt = f.querySelector('[type=submit]');
    bt.disabled = true;
    const { error } = await sb.from('bloqueios').insert(linhas);
    bt.disabled = false;
    if (error) return aviso('erro', limparErro(error));
    aviso('ok', 'Bloqueio registrado.');
    f.motivo.value = '';
    f.querySelectorAll('input[name="turno"]').forEach((i) => { i.checked = false; });
    await mostrarAfetadas(ids, de, ate, marcados, motivo);
    carregarBloqueios();
  });
}

// Reservas já feitas no período bloqueado: avisar e, se for o caso, cancelar
async function mostrarAfetadas(ids, de, ate, marcados, motivo) {
  const { data, error } = await sb.from('reservas')
    .select('codigo, data, status, grupo, responsavel_nome, responsavel_telefone, sala_id, turno_id')
    .in('sala_id', ids).gte('data', de).lte('data', ate).in('status', ATIVOS);
  if (error) return aviso('erro', limparErro(error));
  const codigosTurno = new Set(marcados);
  const afetadas = agrupar(data.filter((l) => !marcados.length || codigosTurno.has(turnoPorId(l.turno_id)?.codigo)));
  const el = $('bloq-afetadas');
  if (!afetadas.length) {
    el.innerHTML = '<div class="aviso aviso-ok">Nenhuma reserva ativa no período bloqueado.</div>';
    return;
  }
  el.innerHTML = `
    <section class="cartao secao" style="border-top:4px solid var(--perigo)">
      <h2>${afetadas.length === 1 ? '1 reserva afetada' : `${afetadas.length} reservas afetadas`}</h2>
      <p class="nota" style="margin:0">Estas reservas continuam ativas. Avise os responsáveis e cancele se for preciso.</p>
      <div class="tabela-caixa"><table class="tabela"><tbody>
        ${afetadas.map((p) => {
          const texto = `Olá, ${primeiroNome(p.responsavel_nome)}! A secretaria da Paróquia São José precisou bloquear ${resumoPedido(p)} (${motivo}). Sua reserva ${p.codigo} será remarcada. Por favor, fale com a secretaria.`;
          return `<tr data-codigo="${esc(p.codigo)}">
            <td><b>${esc(dataComDia(p.data))}</b><br><span class="nota">${esc(p.listaTurnos.map((t) => t.nome).join(', '))}</span></td>
            <td>${esc(nomeSala(salaPorId(p.sala_id) || {}))}</td>
            <td>${esc(p.grupo)}</td>
            <td>${contatoHtml(p)}</td>
            <td><span class="acoes-cel">
              <a class="btn btn-sec btn-peq" href="${linkWhatsApp(p.responsavel_telefone, texto)}" target="_blank" rel="noopener">Avisar no WhatsApp</a>
              <button type="button" class="btn btn-perigo btn-peq" data-cancelar>Cancelar</button>
            </span></td>
          </tr>`;
        }).join('')}
      </tbody></table></div>
    </section>`;
  el.querySelectorAll('tr[data-codigo]').forEach((tr) => {
    const p = afetadas.find((x) => x.codigo === tr.dataset.codigo);
    tr.querySelector('[data-cancelar]').addEventListener('click', () =>
      cancelar(p, () => mostrarAfetadas(ids, de, ate, marcados, motivo)));
  });
}

// ---------------------------------------------------------------- salas
async function carregarSalas() {
  const { data, error } = await sb.from('salas').select('*').order('ordem').order('numero');
  if (error) throw error;
  salas = data;
  preencherSelects();
  const ativas = salas.filter((s) => s.ativa && !s.excluida_em);
  const porCap = {};
  ativas.filter((s) => s.tipo === 'comum').forEach((s) => { porCap[s.capacidade] = (porCap[s.capacidade] || 0) + 1; });
  const partes = Object.entries(porCap).sort((a, b) => b[0] - a[0]).map(([c, n]) => `${n} para ${c} pessoas`);
  const pal = ativas.filter((s) => s.tipo === 'palestra').length;
  if (pal) partes.push(pal === 1 ? '1 sala de palestra' : `${pal} salas de palestra`);
  $('salas-resumo').textContent = `${ativas.length} salas ativas · ${partes.join(' · ')}`;

  $('salas-linhas').innerHTML = salas.filter((s) => !s.excluida_em).map((s) => `
    <tr>
      <td><b>${esc(nomeSala(s))}</b>${s.nome ? ` <span class="nota">(nº ${esc(s.numero)})</span>` : ''}
        <br><span class="nota">${(s.itens || []).length ? `${s.itens.length} ${s.itens.length === 1 ? 'item' : 'itens'}` : 'Sem itens cadastrados'}</span></td>
      <td>${s.capacidade} pessoas</td>
      <td>${s.tipo === 'palestra' ? 'Sala de palestra' : 'Sala comum'}</td>
      <td><span class="etq ${s.controlada ? 'etq-pend' : 'etq-azul'}">${s.controlada ? 'Exige aprovação' : 'Na hora'}</span></td>
      <td><span class="etq ${s.ativa ? 'etq-ok' : 'etq-bloq'}">${s.ativa ? 'Ativa' : 'Desativada'}</span></td>
      <td><span class="acoes-cel">
        <button type="button" class="btn btn-sec btn-peq" data-editar="${s.id}">Alterar</button>
        <button type="button" class="btn btn-sec btn-peq" data-itens="${s.id}">Itens</button>
        <button type="button" class="btn btn-sec btn-peq" data-ativar="${s.id}">${s.ativa ? 'Desativar' : 'Reativar'}</button>
        <button type="button" class="btn btn-perigo btn-peq" data-excluir-sala="${s.id}">Excluir</button>
      </span></td>
    </tr>`).join('');

  $('salas-linhas').querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editarSala(Number(b.dataset.editar))));
  $('salas-linhas').querySelectorAll('[data-ativar]').forEach((b) => b.addEventListener('click', () => alternarSala(Number(b.dataset.ativar))));
  $('salas-linhas').querySelectorAll('[data-itens]').forEach((b) => b.addEventListener('click', () => abrirItens(Number(b.dataset.itens))));
  $('salas-linhas').querySelectorAll('[data-excluir-sala]').forEach((b) => b.addEventListener('click', () => excluirSala(Number(b.dataset.excluirSala))));
}

// ---------------------------------------------------------------- itens da sala
let itensSalaId = null;
let itensEdicao = [];

function abrirItens(id) {
  const s = salaPorId(id);
  itensSalaId = id;
  itensEdicao = (s.itens || []).map((i) => ({ descricao: i.descricao || '', quantidade: i.quantidade ?? '' }));
  if (!itensEdicao.length) itensEdicao.push({ descricao: '', quantidade: '' });
  $('it-titulo').textContent = `Itens da ${nomeSala(s)}`;
  $('it-erro').hidden = true;
  desenharItens();
  $('dlg-itens').showModal();
}

function desenharItens() {
  $('it-linhas').innerHTML = itensEdicao.map((i, n) => `
    <li class="item-linha" data-n="${n}">
      <input type="text" data-c="descricao" value="${esc(i.descricao)}" maxlength="80" placeholder="Ex.: Cadeiras" aria-label="Descrição do item">
      <input type="number" data-c="quantidade" value="${esc(i.quantidade)}" min="1" max="9999" placeholder="Qtd." aria-label="Quantidade">
      <button type="button" class="btn btn-perigo btn-peq" data-rem="${n}" aria-label="Remover item">Remover</button>
    </li>`).join('') || '<li class="nota">Nenhum item. Use "Adicionar item".</li>';
  $('it-linhas').querySelectorAll('[data-c]').forEach((el) => el.addEventListener('input', () => {
    itensEdicao[Number(el.closest('li').dataset.n)][el.dataset.c] = el.value;
  }));
  $('it-linhas').querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => {
    itensEdicao.splice(Number(b.dataset.rem), 1);
    desenharItens();
  }));
}

function ligarItens() {
  $('it-novo').addEventListener('click', () => {
    itensEdicao.push({ descricao: '', quantidade: '' });
    desenharItens();
    $('it-linhas').querySelector('li:last-child input')?.focus();
  });
  document.querySelector('[data-fechar-itens]').addEventListener('click', () => $('dlg-itens').close());
  $('f-itens').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itens = itensEdicao
      .map((i) => ({ descricao: String(i.descricao).trim(), quantidade: i.quantidade === '' ? null : Number(i.quantidade) }))
      .filter((i) => i.descricao);
    if (itens.some((i) => i.quantidade !== null && !(i.quantidade > 0))) {
      $('it-erro').textContent = 'A quantidade precisa ser um número maior que zero (ou fique em branco).';
      $('it-erro').hidden = false;
      return;
    }
    const { error } = await sb.from('salas').update({ itens: itens.map((i) => (i.quantidade ? i : { descricao: i.descricao })) }).eq('id', itensSalaId);
    if (error) { $('it-erro').textContent = limparErro(error); $('it-erro').hidden = false; return; }
    $('dlg-itens').close();
    aviso('ok', `Itens da ${nomeSala(salaPorId(itensSalaId))} salvos.`);
    carregarSalas();
  });
}

async function excluirSala(id) {
  const s = salaPorId(id);
  const nome = nomeSala(s);
  if (!confirm(`Excluir ${nome}?\n\nA sala sai do site e da gestão. As reservas antigas continuam no histórico. As reservas futuras desta sala serão CANCELADAS.\n\nEsta ação não pode ser desfeita.`)) return;
  const { data, error } = await sb.rpc('excluir_sala', { p_id: id });
  if (error) return aviso('erro', limparErro(error));
  const lista = data || [];
  if (!lista.length) {
    aviso('ok', `${nome} excluída. Não havia reservas futuras.`);
  } else {
    const porCodigo = new Map();
    lista.forEach((r) => {
      const p = porCodigo.get(r.codigo) || { ...r, itens: [] };
      p.itens.push(`${dataCurta(r.data)} ${r.turno}`);
      porCodigo.set(r.codigo, p);
    });
    const avisos = [...porCodigo.values()].map((p) => {
      const texto = `Olá, ${primeiroNome(p.responsavel_nome)}! A reserva ${p.codigo} (${nome}, ${p.itens.join(', ')}) foi CANCELADA porque a sala não está mais disponível. Por favor, faça uma nova reserva em outra sala ou fale com a secretaria da Paróquia São José.`;
      return `<br>• ${esc(p.codigo)} · ${esc(p.grupo)} · ${esc(p.itens.join(', '))} — <a href="${linkWhatsApp(p.responsavel_telefone, texto)}" target="_blank" rel="noopener">Avisar no WhatsApp</a>`;
    }).join('');
    aviso('ok', `${nome} excluída. ${porCodigo.size === 1 ? '1 reserva futura foi cancelada' : `${porCodigo.size} reservas futuras foram canceladas`}:`, avisos);
  }
  if ($('f-sala').elements.sala_id.value === String(id)) $('f-sala').reset();
  carregarSalas();
  atualizarContador();
}

function editarSala(id) {
  const s = salaPorId(id);
  const f = $('f-sala');
  f.elements.sala_id.value = s.id;
  f.elements.numero.value = s.numero;
  f.elements.capacidade.value = s.capacidade;
  f.elements.tipo.value = s.tipo;
  f.elements.nome_sala.value = s.nome || '';
  f.elements.controlada.checked = s.controlada;
  f.elements.ativa.checked = s.ativa;
  f.elements.ordem.value = s.ordem;
  $('sala-titulo').textContent = `Alterar ${nomeSala(s)}`;
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function alternarSala(id) {
  const s = salaPorId(id);
  if (s.ativa && !confirm(`Desativar ${nomeSala(s)}? Ela some do site e não aceita novas reservas; as reservas antigas continuam guardadas.`)) return;
  const { error } = await sb.from('salas').update({ ativa: !s.ativa }).eq('id', id);
  if (error) return aviso('erro', limparErro(error));
  aviso('ok', `${nomeSala(s)} ${s.ativa ? 'desativada' : 'reativada'}.`);
  carregarSalas();
}

function ligarSalas() {
  const f = $('f-sala');
  f.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', () => {
    if (f.elements.tipo.value === 'palestra') f.elements.controlada.checked = true;
  }));
  f.addEventListener('reset', () => setTimeout(() => { f.elements.sala_id.value = ''; $('sala-titulo').textContent = 'Nova sala'; }, 0));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = f.elements;
    const numero = el.numero.value.trim();
    const capacidade = Number(el.capacidade.value);
    if (!numero || !(capacidade > 0)) return aviso('erro', 'Informe o número da sala e a capacidade.');
    const dados = {
      numero,
      capacidade,
      tipo: el.tipo.value,
      nome: el.nome_sala.value.trim() || null,
      controlada: el.controlada.checked,
      ativa: el.ativa.checked,
      ordem: el.ordem.value !== '' ? Number(el.ordem.value) : (Number(numero) || 0),
    };
    const id = el.sala_id.value;
    const { error } = id
      ? await sb.from('salas').update(dados).eq('id', Number(id))
      : await sb.from('salas').insert(dados);
    if (error) {
      return aviso('erro', /duplicate key/i.test(error.message) ? `Já existe uma sala com o número ${numero}.` : limparErro(error));
    }
    aviso('ok', id ? 'Sala alterada.' : 'Sala cadastrada.');
    f.reset();
    carregarSalas();
  });
}

// ---------------------------------------------------------------- coordenadores
let coordenadores = [];

async function carregarCoordenadores() {
  const { data, error } = await sb.from('solicitantes').select('id, nome, telefone, email, grupo, criado_em').order('nome');
  if (error) throw error;
  coordenadores = data;
  desenharCoordenadores();
}

function desenharCoordenadores() {
  const q = $('coord-busca').value.trim().toLowerCase();
  const lista = coordenadores.filter((c) => !q || [c.nome, c.grupo, c.email].some((x) => (x || '').toLowerCase().includes(q)));
  $('coord-linhas').innerHTML = lista.map((c) => `
    <tr>
      <td><b>${esc(c.nome || '—')}</b></td>
      <td>${esc(c.grupo || '—')}</td>
      <td>${c.telefone ? `<a href="${linkWhatsApp(c.telefone, '')}" target="_blank" rel="noopener">${esc(c.telefone)}</a>` : '—'}</td>
      <td>${esc(c.email)}</td>
      <td>${esc(dataCurta(c.criado_em.slice(0, 10)))}</td>
      <td><span class="acoes-cel">${c.id === usuario?.id ? '<span class="nota">Sua conta</span>'
        : `<button type="button" class="btn btn-sec btn-peq" data-senha-coord="${esc(c.id)}">Nova senha</button>
           <button type="button" class="btn btn-perigo btn-peq" data-excluir-coord="${esc(c.id)}">Excluir</button>`}</span></td>
    </tr>`).join('') || '<tr><td colspan="6" class="nota">Nenhum coordenador encontrado.</td></tr>';
  $('coord-linhas').querySelectorAll('[data-senha-coord]').forEach((b) => b.addEventListener('click', () =>
    novaSenha(coordenadores.find((c) => c.id === b.dataset.senhaCoord))));
  $('coord-linhas').querySelectorAll('[data-excluir-coord]').forEach((b) => b.addEventListener('click', () =>
    excluirCoordenador(coordenadores.find((c) => c.id === b.dataset.excluirCoord))));
}

// Senha provisória fácil de ditar (sem letras e números parecidos)
function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const sorteio = (txt, n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => txt[x % txt.length]).join('');
  return sorteio(letras, 4) + sorteio(numeros, 4);
}

async function novaSenha(c) {
  const quem = c.nome ? `${c.nome} (${c.email})` : c.email;
  const senha = prompt(`Nova senha para ${quem}.\nUse a sugerida ou digite outra (mínimo de 6 caracteres):`, gerarSenha());
  if (senha === null) return;
  if (senha.trim().length < 6) return aviso('erro', 'A senha precisa ter pelo menos 6 caracteres.');
  const { error } = await sb.rpc('definir_senha', { p_id: c.id, p_senha: senha.trim() });
  if (error) return aviso('erro', limparErro(error));
  const site = location.href.replace(/secretaria\.html.*$/, '');
  const texto = `Olá${c.nome ? `, ${primeiroNome(c.nome)}` : ''}! A secretaria da Paróquia São José definiu uma nova senha para você no Sistema de Reservas de salas.\n`
    + `Login (e-mail): ${c.email}\nSenha provisória: ${senha.trim()}\n`
    + `Entre em ${site} e troque a senha em "Alterar senha".`;
  aviso('ok', `Nova senha de ${quem}: ${senha.trim()} — anote ou envie agora.`,
    c.telefone ? linkAvisar({ responsavel_telefone: c.telefone, responsavel_nome: c.nome }, texto, 'Enviar no WhatsApp') : '');
}

async function excluirCoordenador(c) {
  const quem = c.nome ? `${c.nome} (${c.email})` : c.email;
  const ok = confirm(`EXCLUIR o cadastro de ${quem}?\n\n`
    + 'A pessoa perde o acesso ao site e precisará criar um novo acesso para reservar. '
    + 'As reservas dela continuam no histórico. Não é possível desfazer.');
  if (!ok) return;
  const { error } = await sb.rpc('excluir_coordenador', { p_id: c.id });
  if (error) return aviso('erro', limparErro(error));
  aviso('ok', `Cadastro de ${quem} excluído.`);
  carregarCoordenadores();
}

// ---------------------------------------------------------------- configurações
const CHAVES = ['antecedencia_min_horas', 'janela_dias', 'prazo_aprovacao_horas', 'telefone_secretaria', 'texto_regras'];

async function carregarConfig() {
  const { data, error } = await sb.from('configuracoes').select('chave, valor');
  if (error) throw error;
  const f = $('f-config');
  for (const { chave, valor } of data) if (f.elements[chave]) f.elements[chave].value = valor;
}

function ligarConfig() {
  $('f-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const linhas = CHAVES.map((chave) => ({ chave, valor: String(f.elements[chave].value).trim() }));
    if (linhas.some((l) => ['antecedencia_min_horas', 'janela_dias', 'prazo_aprovacao_horas'].includes(l.chave) && !/^\d+$/.test(l.valor))) {
      return aviso('erro', 'Antecedência, dias e prazo precisam ser números inteiros.');
    }
    const { error } = await sb.from('configuracoes').upsert(linhas, { onConflict: 'chave' });
    if (error) return aviso('erro', limparErro(error));
    aviso('ok', 'Configurações salvas. Já valem para as próximas reservas.');
  });
}

// ---------------------------------------------------------------- início
async function iniciar() {
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') {
      recuperandoSenha = true;
      mostrar('v-login');
      $('f-login').hidden = true;
      $('f-nova').hidden = false;
      mostrarLoginMsg('info', 'Crie sua nova senha.');
    }
  });

  ligarLogin();
  ligarBloqueios();
  ligarSalas();
  ligarItens();
  ligarConfig();
  document.querySelectorAll('.abas-gestao [data-aba]').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));
  $('f-filtro').addEventListener('change', (e) => { if (e.target.name !== 'busca') carregarReservas().catch((er) => aviso('erro', limparErro(er))); });
  $('f-filtro').busca.addEventListener('input', desenharReservas);
  $('f-filtro').addEventListener('submit', (e) => e.preventDefault());
  $('coord-busca').addEventListener('input', desenharCoordenadores);

  const { data } = await sb.auth.getSession();
  if (recuperandoSenha) return;
  await entrarComUsuario(data.session?.user || null);
}

iniciar();

// Permite instalar como app no celular (PWA)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
