// Direcionamento Espiritual: a pessoa vê os horários livres e pede um horário.
// O pedido fica aguardando a confirmação da secretaria ou do Pároco. Não precisa de login.
import { sb, limparErro } from '../api.js';
import { montarPagina, sessao } from '../ui.js';
import {
  esc, hojeISO, somaDias, diaSemana, dataLonga, dataCurta, hora, agoraSP,
  mascaraTelefone, soDigitos, DIAS_LONGOS,
} from '../util.js';

const $ = (id) => document.getElementById(id);
const DIAS = 14;
// Área de atendimento da paróquia: endereços que começam com QND ou QNE
const MSG_AREA = 'Este endereço não pertence à área de atendimento da Paróquia São José (QND e QNE). Procure a paróquia e o pároco responsáveis pela região onde você mora.';
const enderecoNaArea = (t) => /^(QND|QNE)/.test(String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
const PUBLICO = { paroquianos: 'Paroquianos', enfermos: 'Enfermos' };
const TIPO = { paroquiano: 'Paroquiano', externo: 'Não paroquiano', enfermo: 'Enfermo' };

let horarios = [], ocupados = [], bloqueios = [];
let slotAtual = null;

const hm = (t) => (t || '').slice(0, 5);
const hh = (t) => hora(hm(t) + ':00');
function somaMin(t, min) {
  const [h, m] = hm(t).split(':').map(Number);
  const total = h * 60 + m + min;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function passou(data, inicio) {
  const agora = agoraSP();
  return data < agora.data || (data === agora.data && hm(inicio) <= agora.hora);
}
function bloqueado(data, ini, fim) {
  return bloqueios.some((b) => data >= b.data_inicio && data <= b.data_fim
    && (!b.inicio || (ini < hm(b.fim || '24:00') && fim > hm(b.inicio))));
}
function aviso(tipo, texto) {
  const el = $('msg');
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function slotsDoDia(data) {
  const dow = diaSemana(data);
  const lista = [];
  horarios.filter((h) => h.dia_semana === dow).forEach((h) => {
    let ini = hm(h.inicio);
    while (somaMin(ini, h.duracao_min) <= hm(h.fim)) {
      const fim = somaMin(ini, h.duracao_min);
      lista.push({ data, inicio: ini, fim, publico: h.publico });
      ini = fim;
    }
  });
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// ---------------------------------------------------------------- dados
async function carregar() {
  const de = hojeISO();
  const { data, error } = await sb.rpc('atend_agenda_publica', { p_de: de, p_ate: somaDias(de, DIAS) });
  if (error) throw error;
  horarios = data.horarios || [];
  ocupados = data.ocupados || [];
  bloqueios = data.bloqueios || [];
  desenharGrade();
  desenharDias();
}

function desenharGrade() {
  $('grade').innerHTML = horarios.map((h) => `
    <li><b>${esc(DIAS_LONGOS[h.dia_semana])}</b><span>${esc(hh(h.inicio))} às ${esc(hh(h.fim))}</span>
      <span class="etq ${h.publico === 'enfermos' ? 'etq-externo' : 'etq-azul'}">${PUBLICO[h.publico]}</span></li>`).join('');
}

function desenharDias() {
  const hoje = hojeISO();
  const dias = [];
  for (let i = 0; i <= DIAS; i++) {
    const data = somaDias(hoje, i);
    const slots = slotsDoDia(data).filter((s) => !passou(s.data, s.inicio));
    if (slots.length) dias.push({ data, slots });
  }
  $('dias').innerHTML = dias.map(({ data, slots }) => {
    const publicos = [...new Set(slots.map((s) => s.publico))];
    return `
      <article class="cartao dia-atend linha-dourada">
        <div class="dia-atend-cab">
          <div>
            <h3>${esc(DIAS_LONGOS[diaSemana(data)])}</h3>
            <span class="nota">${esc(dataCurta(data))}</span>
          </div>
          <div class="acoes">${publicos.map((p) => `<span class="etq ${p === 'enfermos' ? 'etq-externo' : 'etq-azul'}">${PUBLICO[p]}</span>`).join('')}</div>
        </div>
        <div class="dir-horas">${slots.map((s) => {
          const ocup = ocupados.some((o) => o.data === s.data && hm(o.inicio) === s.inicio) || bloqueado(s.data, s.inicio, s.fim);
          return ocup
            ? `<button type="button" class="dir-hora" disabled aria-label="${esc(hh(s.inicio))}, ocupado"><b>${esc(hh(s.inicio))}</b><span>Ocupado</span></button>`
            : `<button type="button" class="dir-hora" data-data="${s.data}" data-inicio="${s.inicio}" data-fim="${s.fim}" data-publico="${s.publico}"><b>${esc(hh(s.inicio))}</b><span>Livre</span></button>`;
        }).join('')}</div>
      </article>`;
  }).join('') || '<div class="vazio">Não há horários de atendimento nos próximos dias.</div>';

  $('dias').querySelectorAll('.dir-hora[data-data]').forEach((b) => b.addEventListener('click', () => abrirPedido({ ...b.dataset })));
}

// ---------------------------------------------------------------- pedido
function abrirPedido(slot) {
  slotAtual = slot;
  const f = $('f-pedir');
  const nome = f.nome.value, tel = f.telefone.value, end = f.endereco.value;
  f.reset();
  f.nome.value = nome || sessao?.solicitante?.nome || '';
  f.telefone.value = tel || sessao?.solicitante?.telefone || '';
  f.endereco.value = end;
  $('pd-erro').hidden = true;
  $('pd-quando').textContent = `${dataLonga(slot.data)}, às ${hh(slot.inicio)}`;

  const opcoes = slot.publico === 'enfermos'
    ? [['enfermo', 'Enfermo (o Pároco vai até o endereço)']]
    : [['paroquiano', 'Paroquiano']];
  const marcado = slot.publico === 'enfermos' ? 'enfermo' : 'paroquiano';
  $('pd-tipos').innerHTML = '<legend class="campo"><span>Para quem é o atendimento <span class="obrig" aria-hidden="true">*</span></span></legend>'
    + opcoes.map(([v, t]) => `<label class="marcar"><input type="radio" name="tipo" value="${v}" ${v === marcado ? 'checked' : ''}>${esc(t)}</label>`).join('');
  $('pd-tipos').querySelectorAll('input').forEach((r) => r.addEventListener('change', ajustar));
  ajustar();
  $('dlg-pedir').showModal();
}

function ajustar() {
  const f = $('f-pedir');
  const tipo = f.querySelector('input[name="tipo"]:checked')?.value;
  const externo = tipo === 'externo';
  const enfermo = tipo === 'enfermo';
  $('pd-externo').hidden = !externo;
  f.paroquia.required = externo;
  f.paroco.required = externo;
  $('pd-rotulo-end').textContent = enfermo ? 'Endereço residencial do enfermo' : 'Endereço';
  $('pd-campo-local').hidden = !enfermo;
  f.local.required = enfermo;
  $('pd-rotulo-assunto').textContent = enfermo ? 'Observações (estado do enfermo, ponto de referência)' : 'Assunto (opcional)';
  $('pd-regra').textContent = externo
    ? 'Não paroquiano: o pedido será confirmado pela secretaria em no máximo 48 horas.'
    : enfermo
      ? 'O Pároco vai até o local informado. O pedido será confirmado pela secretaria ou pelo Pároco.'
      : 'O pedido será confirmado pela secretaria ou pelo Pároco. Você recebe o aviso pelo WhatsApp.';
}

function ligarPedido() {
  const f = $('f-pedir');
  mascaraTelefone(f.telefone);
  const erro = (t) => { $('pd-erro').textContent = t; $('pd-erro').hidden = false; };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = f.querySelector('input[name="tipo"]:checked')?.value;
    if (!tipo) return erro('Escolha para quem é o atendimento.');
    if (!f.nome.value.trim()) return erro('Informe o nome.');
    if (soDigitos(f.telefone.value).length < 10) return erro('Informe o telefone com DDD.');
    if (!f.endereco.value.trim()) return erro('Informe o endereço.');
    if (!enderecoNaArea(f.endereco.value)) return erro(MSG_AREA);
    if (tipo === 'enfermo' && !f.local.value.trim()) return erro('Informe o local onde o enfermo se encontra.');
    if (tipo === 'externo' && !f.paroquia.value.trim()) return erro('Informe a paróquia em que atua.');
    if (tipo === 'externo' && !f.paroco.value.trim()) return erro('Informe o nome do pároco responsável.');
    const bt = $('pd-enviar');
    bt.disabled = true;
    bt.textContent = 'Enviando…';
    const { error } = await sb.rpc('solicitar_atendimento', {
      p_data: slotAtual.data, p_inicio: slotAtual.inicio, p_fim: slotAtual.fim,
      p_nome: f.nome.value.trim(), p_telefone: f.telefone.value.trim(), p_tipo: tipo,
      p_assunto: f.assunto.value.trim() || null, p_endereco: f.endereco.value.trim(),
      p_paroquia: f.paroquia.value.trim() || null, p_paroco: f.paroco.value.trim() || null,
      p_local: tipo === 'enfermo' ? f.local.value.trim() : null,
    });
    bt.disabled = false;
    bt.textContent = 'Enviar pedido';
    if (error) return erro(limparErro(error));
    $('dlg-pedir').close();
    aviso('ok', `Pedido enviado para ${dataLonga(slotAtual.data).toLowerCase()}, às ${hh(slotAtual.inicio)}. `
      + 'A secretaria ou o Pároco confirma e avisa você pelo WhatsApp. Para cancelar, fale com a secretaria paroquial.');
    await carregar();
  });
  document.querySelectorAll('dialog [data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
}

// ---------------------------------------------------------------- início
async function iniciar() {
  await montarPagina('direcionamento');
  ligarPedido();
  try {
    await carregar();
  } catch (e) {
    $('dias').innerHTML = '';
    aviso('erro', `Não foi possível carregar a agenda. ${limparErro(e)}`);
  }
}

iniciar();
