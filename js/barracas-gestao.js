// Aba "Barracas" da Área de Gestão: aprovar/recusar pedidos, bloquear finais de semana
// e acompanhar as reservas. Tudo nas tabelas próprias das barracas (as salas não mudam).
import { sb, limparErro } from './api.js';
import { esc, hojeISO, dataLonga, dataCurta, linkWhatsApp, primeiroNome, DIAS_CURTOS, diaSemana, somaDias } from './util.js';
import { agruparBarracas, descreverDias, nomeTurnoBarraca, linkComprovanteBarraca } from './barracas.js';

const $ = (id) => document.getElementById(id);
const ATIVOS = ['pendente', 'confirmada'];
const SITUACAO = {
  confirmada: ['Confirmada', 'etq-ok'], pendente: ['Pendente', 'etq-pend'], recusada: ['Recusada', 'etq-res'],
  cancelada: ['Cancelada', 'etq-bloq'], expirada: ['Expirada', 'etq-bloq'], realizada: ['Realizada', 'etq-azul'],
};
const CAMPOS = 'codigo, data, turno, status, grupo, responsavel_nome, responsavel_telefone, mensagem, motivo_recusa, criado_em';

let usuario = null;
let ligado = false;
let reservas = [];

function aviso(tipo, texto, extraHtml = '') {
  const el = $('br-msg');
  el.className = `aviso aviso-${tipo}`;
  el.innerHTML = `<span>${esc(texto)}${extraHtml ? ' ' + extraHtml : ''}</span>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const diaCurto = (iso) => `${DIAS_CURTOS[diaSemana(iso)]} ${dataCurta(iso)}`;
const listaDias = (p) => p.dias.map((d) => `<b>${esc(diaCurto(d.data))}</b><br><span class="nota">${esc(d.turnos.map(nomeTurnoBarraca).join(', '))}</span>`).join('<br>');
const contato = (p) => `<b>${esc(p.responsavel_nome || '—')}</b><br>
  <a href="${linkWhatsApp(p.responsavel_telefone, '')}" target="_blank" rel="noopener">${esc(p.responsavel_telefone || '')}</a>`;

async function telefoneSecretaria() {
  const { data } = await sb.from('configuracoes').select('valor').eq('chave', 'telefone_secretaria').maybeSingle();
  return data?.valor || '';
}

// ---------------------------------------------------------------- contador da aba
export async function contarBarracasPendentes() {
  const { data, error } = await sb.from('barracas_reservas').select('codigo').eq('status', 'pendente');
  const el = $('cont-barracas');
  if (!el) return;
  const n = error ? 0 : new Set((data || []).map((x) => x.codigo)).size;
  el.textContent = n;
  el.hidden = n === 0;
}

// ---------------------------------------------------------------- abrir a aba
export async function carregarBarracasGestao({ user }) {
  usuario = user;
  ligar();
  await sb.rpc('expirar_barracas').then(() => {}, () => {});
  const teste = await sb.from('barracas_reservas').select('id').limit(1);
  if (teste.error) {
    throw new Error(`Não foi possível carregar as barracas. Verifique se o arquivo atualizacao-barracas.sql foi executado no Supabase. ${limparErro(teste.error)}`);
  }
  await Promise.all([carregarPendentes(), carregarBloqueios(), carregarReservas()]);
}

// ---------------------------------------------------------------- pendentes
async function carregarPendentes() {
  const { data, error } = await sb.from('barracas_reservas').select(CAMPOS).eq('status', 'pendente').order('data');
  if (error) throw error;
  const pedidos = agruparBarracas(data);
  $('br-pend-resumo').textContent = pedidos.length === 1 ? '1 pedido aguardando' : `${pedidos.length} pedidos aguardando`;
  contarBarracasPendentes();
  if (!pedidos.length) { $('br-pend').innerHTML = '<div class="vazio">Nenhum pedido de barraca aguardando aprovação.</div>'; return; }

  $('br-pend').innerHTML = `<div class="grade-salas" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${pedidos.map((p) => `
    <article class="cartao" style="display:flex;flex-direction:column;gap:8px;border-top:4px solid var(--dourado)" data-codigo="${esc(p.codigo)}">
      <div class="sala-topo"><span class="sala-nome">Barraca</span><span class="etq etq-pend">${esc(p.codigo)}</span></div>
      <span>${listaDias(p)}</span>
      <span><b>${esc(p.grupo)}</b></span>
      <span class="nota">${esc(p.responsavel_nome)} · <a href="${linkWhatsApp(p.responsavel_telefone, '')}" target="_blank" rel="noopener">${esc(p.responsavel_telefone)}</a></span>
      ${p.mensagem ? `<div class="aviso aviso-info barr-msg"><span><b>Mensagem:</b> ${esc(p.mensagem)}</span></div>` : ''}
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
    </article>`).join('')}</div>`;

  $('br-pend').querySelectorAll('[data-codigo]').forEach((card) => {
    const p = pedidos.find((x) => x.codigo === card.dataset.codigo);
    card.querySelector('[data-aprovar]').addEventListener('click', (e) => { e.target.disabled = true; decidir(p, true); });
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
  const { error } = await sb.rpc('decidir_barraca', { p_codigo: p.codigo, p_aprovar: aprovar, p_motivo: motivo || null });
  if (error) { aviso('erro', limparErro(error)); await carregarPendentes(); return; }
  const nome = primeiroNome(p.responsavel_nome);
  const link = linkComprovanteBarraca(p.codigo);
  const tel = await telefoneSecretaria();
  const quando = descreverDias(p.dias);
  const texto = aprovar
    ? `Olá, ${nome}! A reserva de barraca ${p.codigo} da ${p.grupo} (${quando}) foi APROVADA pela secretaria da Paróquia São José. Comprovante: ${link}`
    : `Olá, ${nome}! A reserva de barraca ${p.codigo} da ${p.grupo} (${quando}) não pôde ser aprovada. Motivo: ${motivo}. Comprovante: ${link}. Em caso de dúvida, fale com a secretaria paroquial ${tel}.`;
  aviso('ok', aprovar ? `Pedido ${p.codigo} aprovado.` : `Pedido ${p.codigo} recusado e turnos liberados.`,
    `<a class="btn btn-peq" href="${linkWhatsApp(p.responsavel_telefone, texto)}" target="_blank" rel="noopener">Avisar pelo WhatsApp</a>`);
  await Promise.all([carregarPendentes(), carregarReservas()]);
}

// ---------------------------------------------------------------- bloqueios
async function carregarBloqueios() {
  const f = $('f-br-bloq');
  if (!f.data.value) f.data.value = proximoSabado();
  const { data, error } = await sb.from('barracas_bloqueios').select('*').gte('data_fim', hojeISO()).order('data_inicio');
  if (error) throw error;
  $('br-bloq-linhas').innerHTML = (data || []).map((b) => {
    const periodo = b.data_inicio === b.data_fim ? diaCurto(b.data_inicio) : `${diaCurto(b.data_inicio)} e ${diaCurto(b.data_fim)}`;
    return `<tr>
      <td><b>${esc(periodo)}</b></td><td>${esc(b.motivo)}</td>
      <td><span class="acoes-cel"><button type="button" class="btn btn-perigo btn-peq" data-remover="${b.id}">Remover</button></span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="nota">Nenhum bloqueio atual ou futuro.</td></tr>';

  $('br-bloq-linhas').querySelectorAll('[data-remover]').forEach((bt) => bt.addEventListener('click', async () => {
    const b = data.find((x) => String(x.id) === bt.dataset.remover);
    if (!confirm(`Remover o bloqueio "${b.motivo}"? As pastorais voltam a poder pedir barraca nesses dias.`)) return;
    const { error: e } = await sb.from('barracas_bloqueios').delete().eq('id', b.id);
    if (e) return aviso('erro', limparErro(e));
    aviso('ok', 'Bloqueio removido.');
    carregarBloqueios();
  }));
}

function proximoSabado() {
  const h = hojeISO();
  return somaDias(h, (6 - diaSemana(h) + 7) % 7);
}

// A partir de uma data do fim de semana, devolve o período a bloquear
function periodoBloqueio(data, dias) {
  const dow = diaSemana(data);
  if (dow !== 0 && dow !== 6) return null;
  const sabado = dow === 6 ? data : somaDias(data, -1);
  const domingo = somaDias(sabado, 1);
  if (dias === 'sabado') return [sabado, sabado];
  if (dias === 'domingo') return [domingo, domingo];
  return [sabado, domingo];
}

function ligarBloqueio() {
  $('f-br-bloq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const motivo = f.motivo.value.trim();
    const periodo = f.data.value ? periodoBloqueio(f.data.value, f.dias.value) : null;
    if (!periodo) return aviso('erro', 'Escolha um sábado ou um domingo.');
    if (periodo[1] < hojeISO()) return aviso('erro', 'Esse fim de semana já passou.');
    if (!motivo) return aviso('erro', 'Informe o motivo do bloqueio.');
    const bt = f.querySelector('[type=submit]');
    bt.disabled = true;
    const { error } = await sb.from('barracas_bloqueios').insert({ data_inicio: periodo[0], data_fim: periodo[1], motivo, criado_por: usuario?.id || null });
    bt.disabled = false;
    if (error) return aviso('erro', limparErro(error));
    aviso('ok', 'Bloqueio registrado.');
    f.motivo.value = '';
    await mostrarAfetadas(periodo[0], periodo[1], motivo);
    carregarBloqueios();
  });
}

// Reservas já feitas nos dias bloqueados: avisar e, se for o caso, cancelar
async function mostrarAfetadas(de, ate, motivo) {
  const { data, error } = await sb.from('barracas_reservas').select(CAMPOS).gte('data', de).lte('data', ate).in('status', ATIVOS);
  if (error) return aviso('erro', limparErro(error));
  const afetadas = agruparBarracas(data);
  const el = $('br-afetadas');
  if (!afetadas.length) { el.innerHTML = '<div class="aviso aviso-ok">Nenhuma reserva de barraca ativa nos dias bloqueados.</div>'; return; }
  el.innerHTML = `
    <section class="cartao secao" style="border-top:4px solid var(--perigo)">
      <h2>${afetadas.length === 1 ? '1 reserva afetada' : `${afetadas.length} reservas afetadas`}</h2>
      <p class="nota" style="margin:0">Estas reservas continuam ativas. Avise os responsáveis e cancele se for preciso.</p>
      <div class="tabela-caixa"><table class="tabela"><tbody>
        ${afetadas.map((p) => {
          const texto = `Olá, ${primeiroNome(p.responsavel_nome)}! A secretaria da Paróquia São José precisou bloquear as barracas em ${descreverDias(p.dias)} (${motivo}). A reserva ${p.codigo} da ${p.grupo} será remarcada. Por favor, fale com a secretaria.`;
          return `<tr data-codigo="${esc(p.codigo)}">
            <td>${listaDias(p)}<br><span class="nota">${esc(p.codigo)}</span></td>
            <td>${esc(p.grupo)}</td>
            <td>${contato(p)}</td>
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
    tr.querySelector('[data-cancelar]').addEventListener('click', () => cancelar(p, () => mostrarAfetadas(de, ate, motivo)));
  });
}

// ---------------------------------------------------------------- reservas
async function carregarReservas() {
  const f = $('f-br-filtro');
  if (!f.de.value) f.de.value = hojeISO();
  if (!f.ate.value) f.ate.value = `${hojeISO().slice(0, 4)}-12-31`;
  let q = sb.from('barracas_reservas').select(CAMPOS).gte('data', f.de.value).lte('data', f.ate.value).order('data').limit(2000);
  if (f.situacao.value === 'ativas') q = q.in('status', ATIVOS);
  if (f.situacao.value === 'canceladas') q = q.in('status', ['cancelada', 'recusada', 'expirada']);
  const { data, error } = await q;
  if (error) throw error;
  reservas = agruparBarracas(data);
  desenharReservas();
}

function desenharReservas() {
  const busca = $('f-br-filtro').busca.value.trim().toLowerCase();
  const hoje = hojeISO();
  const lista = reservas.filter((p) => !busca || [p.grupo, p.responsavel_nome, p.codigo].some((x) => (x || '').toLowerCase().includes(busca)));
  $('br-res-resumo').textContent = lista.length === 1 ? '1 reserva' : `${lista.length} reservas`;
  $('br-res-linhas').innerHTML = lista.map((p) => {
    const [txt, cls] = SITUACAO[p.status] || [p.status, 'etq-bloq'];
    const podeCancelar = ATIVOS.includes(p.status) && p.ultimaData >= hoje;
    return `
      <tr data-codigo="${esc(p.codigo)}">
        <td><b>${esc(p.dias.map((d) => diaCurto(d.data)).join(' e '))}</b><br><span class="nota">${esc(p.codigo)}</span></td>
        <td>${p.dias.map((d) => esc(d.turnos.map(nomeTurnoBarraca).join(', '))).join('<br>')}</td>
        <td>${esc(p.grupo)}</td>
        <td>${contato(p)}</td>
        <td class="barr-msg">${esc(p.mensagem || '—')}</td>
        <td><span class="etq ${cls}">${txt}</span>${p.status === 'recusada' && p.motivo_recusa ? `<br><span class="nota">${esc(p.motivo_recusa)}</span>` : ''}</td>
        <td><span class="acoes-cel">
          <a class="btn btn-sec btn-peq" href="${linkComprovanteBarraca(p.codigo)}" target="_blank" rel="noopener">Comprovante</a>
          ${podeCancelar ? '<button type="button" class="btn btn-perigo btn-peq" data-cancelar>Cancelar</button>' : ''}
          <button type="button" class="btn btn-perigo btn-peq" data-excluir title="Apagar definitivamente">Excluir</button>
        </span></td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" class="nota">Nenhuma reserva de barraca no período.</td></tr>';

  $('br-res-linhas').querySelectorAll('tr[data-codigo]').forEach((tr) => {
    const p = reservas.find((x) => x.codigo === tr.dataset.codigo);
    tr.querySelector('[data-cancelar]')?.addEventListener('click', () => cancelar(p, carregarReservas));
    tr.querySelector('[data-excluir]')?.addEventListener('click', () => excluir(p));
  });
}

async function cancelar(p, depois) {
  if (!confirm(`Cancelar a reserva de barraca ${p.codigo} (${p.grupo})? Os turnos ficam livres para outras pastorais.`)) return;
  const { error } = await sb.from('barracas_reservas').update({ status: 'cancelada' }).eq('codigo', p.codigo).in('status', ATIVOS);
  if (error) return aviso('erro', limparErro(error));
  const texto = `Olá, ${primeiroNome(p.responsavel_nome)}! A reserva de barraca ${p.codigo} da ${p.grupo} (${descreverDias(p.dias)}) foi cancelada pela secretaria da Paróquia São José. Em caso de dúvida, fale com a secretaria paroquial ${await telefoneSecretaria()}.`;
  aviso('ok', `Reserva ${p.codigo} cancelada.`,
    `<a class="btn btn-peq" href="${linkWhatsApp(p.responsavel_telefone, texto)}" target="_blank" rel="noopener">Avisar pelo WhatsApp</a>`);
  await depois();
  carregarPendentes();
}

async function excluir(p) {
  const ok = confirm(`EXCLUIR DEFINITIVAMENTE a reserva de barraca ${p.codigo} (${p.grupo})?\n\n`
    + 'Ela some do histórico e o link do comprovante deixa de funcionar. Não é possível desfazer.\n\n'
    + 'Para apenas liberar os turnos, use "Cancelar".');
  if (!ok) return;
  const { data, error } = await sb.from('barracas_reservas').delete().eq('codigo', p.codigo).select('id');
  if (error) return aviso('erro', limparErro(error));
  if (!data?.length) return aviso('erro', 'Nada foi excluído. Confira se a sua conta é da secretaria.');
  aviso('ok', `Reserva ${p.codigo} excluída.`);
  await carregarReservas();
  carregarPendentes();
}

// ---------------------------------------------------------------- eventos (uma vez)
function ligar() {
  if (ligado) return;
  ligado = true;
  ligarBloqueio();
  const f = $('f-br-filtro');
  f.addEventListener('change', (e) => { if (e.target.name !== 'busca') carregarReservas().catch((er) => aviso('erro', limparErro(er))); });
  f.busca.addEventListener('input', desenharReservas);
  f.addEventListener('submit', (e) => e.preventDefault());
}
