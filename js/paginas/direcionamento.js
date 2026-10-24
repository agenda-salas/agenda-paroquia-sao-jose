// Direcionamento Espiritual: a pessoa vê os horários livres e pede um horário.
// O pedido fica aguardando a confirmação da secretaria ou do Pároco. Não precisa de login.
import { sb, limparErro, nomesPastorais, carregarConfig } from '../api.js';
import { montarPagina, sessao } from '../ui.js';
import {
  esc, hojeISO, somaDias, diaSemana, dataLonga, dataCurta, hora, agoraSP,
  mascaraTelefone, soDigitos, DIAS_LONGOS,
} from '../util.js';

const $ = (id) => document.getElementById(id);
const DIAS = 14;
// Endereço da área da paróquia: QND/QNE + quadra, [Conjunto X], Casa N ou Lote N + Apt/Casa N
const MSG_AREA = 'O endereço informado não pertence à área de atendimento da Paróquia São José. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
const MSG_INCOMPLETO = 'Informe o endereço completo: quadra e número da casa, ou lote e apartamento. Ex.: QND XX Casa XX';
const PALAVRAS = { CONJUNTO: 'Conjunto', CONJ: 'Conjunto', CJ: 'Conjunto', CASA: 'Casa', CS: 'Casa', LOTE: 'Lote', LT: 'Lote', APT: 'Apt', APTO: 'Apt', AP: 'Apt', APARTAMENTO: 'Apt' };
// Mesmo padrão usado no banco (endereco_normalizado / endereco_situacao)
function normalizarEndereco(t) {
  return String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ').replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2')
    .trim().replace(/\s+/g, ' ').replace(/^Q ?N ?([DE])(\s|$)/, 'QN$1$2')
    .split(' ').map((w) => ({ CONJ: 'CONJUNTO', CJ: 'CONJUNTO', CS: 'CASA', LT: 'LOTE', AP: 'APT', APTO: 'APT', APARTAMENTO: 'APT' })[w] || w).join(' ');
}
function situacaoEndereco(t) {
  const n = normalizarEndereco(t);
  if (/^QN[DE] \d{1,3}( CONJUNTO [A-Z0-9]{1,3})? (CASA \d{1,4}|LOTE \d{1,4} (APT|CASA) \d{1,4})( .*)?$/.test(n)) return 'ok';
  return /^QN[DE]( |$)/.test(n) ? 'incompleto' : 'fora';
}
// Texto arrumado: "QND 57 Conjunto A Casa 06" (o restante fica com a 1ª letra maiúscula)
function formatarEndereco(t, ateOFim = true) {
  const original = String(t || '');
  const fimAberto = !ateOFim && /[A-Za-zÀ-ÿ]$/.test(original);   // palavra ainda sendo digitada
  const palavras = normalizarEndereco(original).split(' ').filter(Boolean);
  return palavras.map((w, i) => {
    if (fimAberto && i === palavras.length - 1) return w;
    if (i === 0 && /^QN[A-Z]$/.test(w)) return w;
    if (PALAVRAS[w]) return PALAVRAS[w];
    if (/^\d+$/.test(w) || w.length <= 2) return w;
    return w[0] + w.slice(1).toLowerCase();
  }).join(' ') + (/\s$/.test(original) && !ateOFim ? ' ' : '');
}
function mascaraEndereco(input) {
  input.addEventListener('input', () => {
    if (input.selectionStart !== input.value.length) return;   // só arruma quando digita no fim
    const novo = formatarEndereco(input.value, false);
    if (novo !== input.value) input.value = novo;
  });
  input.addEventListener('blur', () => { input.value = formatarEndereco(input.value); });
}
const PUBLICO = { paroquianos: 'Paroquianos', enfermos: 'Enfermos' };
const TIPO = { paroquiano: 'Paroquiano', externo: 'Não paroquiano', enfermo: 'Enfermo' };

let horarios = [], ocupados = [], bloqueios = [];
let pastorais = [];            // nomes do cadastro (sugestões e conferência)
let telSecretaria = '(61) 3354-2921';
const comparavel = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const pastoralOficial = (t) => pastorais.find((n) => comparavel(n) === comparavel(t)) || null;
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
  // Paroquiano informa a pastoral, movimento ou grupo (ou marca que não participa)
  const paroquiano = tipo === 'paroquiano';
  $('pd-campo-pastoral').hidden = !paroquiano;
  f.pastoral.disabled = !paroquiano || f.sem_pastoral.checked;
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
  mascaraEndereco(f.endereco);
  f.sem_pastoral.addEventListener('change', () => {
    f.pastoral.disabled = f.sem_pastoral.checked;
    if (f.sem_pastoral.checked) f.pastoral.value = '';
  });
  f.addEventListener('input', () => { $('pd-erro').hidden = true; });   // ao corrigir, o aviso some
  const erro = (t) => { $('pd-erro').textContent = t; $('pd-erro').hidden = false; };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = f.querySelector('input[name="tipo"]:checked')?.value;
    if (!tipo) return erro('Escolha para quem é o atendimento.');
    if (!f.nome.value.trim()) return erro('Informe o nome.');
    if (soDigitos(f.telefone.value).length < 10) return erro('Informe o telefone com DDD.');
    if (!f.endereco.value.trim()) return erro('Informe o endereço.');
    f.endereco.value = formatarEndereco(f.endereco.value);
    const sit = situacaoEndereco(f.endereco.value);
    if (sit === 'fora') return erro(MSG_AREA);
    if (sit === 'incompleto') return erro(MSG_INCOMPLETO);
    if (tipo === 'enfermo' && !f.local.value.trim()) return erro('Informe o local onde o enfermo se encontra.');
    let pastoral = null;
    if (tipo === 'paroquiano') {
      if (f.sem_pastoral.checked) pastoral = '__nenhuma__';
      else {
        if (!f.pastoral.value.trim()) return erro('Informe a Pastoral, Movimento ou Grupo de que participa, ou marque "Não participo de pastoral".');
        pastoral = pastoralOficial(f.pastoral.value);
        if (!pastoral && pastorais.length) return erro(`Pastoral, Movimento ou Grupo - INVÁLIDO. Digite corretamente o nome ou entre em contato com a secretaria Paroquial ${telSecretaria}`);
        pastoral = pastoral || f.pastoral.value.trim();
        f.pastoral.value = pastoral;
      }
    }
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
      p_pastoral: pastoral,
    });
    bt.disabled = false;
    bt.textContent = 'Enviar pedido';
    if (error) return erro(limparErro(error));
    $('dlg-pedir').close();
    aviso('ok', `Pedido enviado para ${dataLonga(slotAtual.data).toLowerCase()}, às ${hh(slotAtual.inicio)}. `
      + `A secretaria ou o Pároco confirma e avisa você pelo WhatsApp. Para cancelar, fale com a secretaria paroquial ${telSecretaria}.`);
    await carregar();
  });
  document.querySelectorAll('dialog [data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
}

// ---------------------------------------------------------------- início
async function iniciar() {
  await montarPagina('direcionamento');
  ligarPedido();
  // Lista de pastorais (sugestões) e telefone da secretaria
  nomesPastorais().then((n) => {
    pastorais = [...n].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('pd-lista-pastorais').innerHTML = pastorais.map((x) => `<option value="${esc(x)}"></option>`).join('');
  }).catch(() => {});
  carregarConfig().then((c) => { if (c.telefone_secretaria) telSecretaria = c.telefone_secretaria; }).catch(() => {});
  try {
    await carregar();
  } catch (e) {
    $('dias').innerHTML = '';
    aviso('erro', `Não foi possível carregar a agenda. ${limparErro(e)}`);
  }
}

iniciar();
