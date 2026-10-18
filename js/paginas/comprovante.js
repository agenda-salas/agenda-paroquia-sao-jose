// Comprovante (link único): mostra sempre os dados atuais da reserva
import { obterComprovante } from '../api.js';
import { montarPagina, sessao } from '../ui.js';
import { param, dataLonga, faixa, esc, ICONES } from '../util.js';
import { compartilhar } from '../comprovante.js';

const STATUS = {
  confirmada:     { titulo: 'Reserva confirmada', cor: 'var(--verde-tx)', fundo: 'var(--verde-bg)', icone: 'ok' },
  realizada:      { titulo: 'Reserva realizada', cor: 'var(--verde-tx)', fundo: 'var(--verde-bg)', icone: 'ok' },
  pendente:       { titulo: 'Aguardando aprovação', cor: 'var(--pend-tx)', fundo: 'var(--pend-bg)', icone: 'relogio' },
  recusada:       { titulo: 'Reserva recusada', cor: 'var(--perigo)', fundo: '#FBEDED', icone: 'x' },
  cancelada:      { titulo: 'Reserva cancelada', cor: 'var(--perigo)', fundo: '#FBEDED', icone: 'x' },
  expirada:       { titulo: 'Pedido expirado', cor: 'var(--cinza-tx)', fundo: 'var(--cinza-bg)', icone: 'x' },
  nao_compareceu: { titulo: 'Não compareceu', cor: 'var(--cinza-tx)', fundo: 'var(--cinza-bg)', icone: 'x' },
};

async function iniciar() {
  await montarPagina('minhas');
  const el = document.getElementById('comp');
  const codigo = param('c');
  if (!codigo) { el.innerHTML = '<div class="vazio">Código do comprovante não informado.</div>'; return; }

  let linhas;
  try {
    linhas = await obterComprovante(codigo);
  } catch (e) {
    el.innerHTML = `<div class="vazio">Não foi possível abrir o comprovante. ${esc(e.message)}</div>`;
    return;
  }
  if (!linhas.length) { el.innerHTML = '<div class="vazio">Comprovante não encontrado. Confira o código.</div>'; return; }

  const r = linhas[0];
  // Num mesmo pedido todos os turnos têm a mesma situação, salvo alteração da secretaria
  const st = STATUS[r.status] || STATUS.pendente;
  const turnos = linhas.map((l) => `${esc(l.turno)} · ${faixa(l)}`).join('<br>');
  const valido = r.status === 'confirmada';
  const podeCompartilhar = ['confirmada', 'pendente'].includes(r.status);
  const ehDono = !!sessao;

  let nota = '';
  if (r.status === 'pendente') nota = 'A secretaria vai analisar o pedido. Guarde este link: quando a reserva for aprovada, esta página mostrará o comprovante confirmado.';
  if (r.status === 'recusada') nota = `Motivo: ${esc(r.motivo_recusa || 'não informado')}.`;
  if (r.status === 'expirada') nota = 'O pedido não foi aprovado dentro do prazo e o turno foi liberado.';
  if (r.status === 'cancelada') nota = 'Este comprovante não vale mais.';


  el.innerHTML = `
    <div class="comp-marca">
      <img src="img/brasao.png" alt="Brasão da Paróquia São José" onerror="this.remove()">
      <div><b>Reservas de salas</b><span style="font-weight:700">Paróquia São José</span></div>
    </div>

    <section class="comp-cartao">
      <div class="comp-cab">
        <span class="comp-icone" style="background:${st.fundo};color:${st.cor}">${ICONES[st.icone]}</span>
        <h1 style="font-size:21px">${st.titulo}</h1>
        <span class="nota">Código da reserva</span>
        <span class="comp-cod">${esc(r.codigo)}</span>
      </div>
      <dl class="comp-dados">
        <dt>Sala</dt><dd>${esc(r.sala)}</dd>
        <dt>Data</dt><dd>${esc(dataLonga(r.data))}</dd>
        <dt>Turno${linhas.length > 1 ? 's' : ''}</dt><dd>${turnos}</dd>
        <dt>Grupo</dt><dd>${esc(r.grupo)}</dd>
        ${r.tipo === 'externo' ? `<dt>Paróquia</dt><dd>${esc(r.paroquia_origem || '')} <span class="etq etq-externo">Não paroquiano</span></dd>` : ''}
        <dt>Responsável</dt><dd>${esc(r.responsavel)}</dd>
        ${r.motivo ? `<dt>Motivo</dt><dd style="font-weight:600">${esc(r.motivo)}</dd>` : ''}
      </dl>
      ${nota ? `<div class="comp-regras" style="background:${st.fundo};color:${st.cor};font-weight:600">${nota}</div>` : ''}
      <div class="comp-regras">${esc(r.regras || '')}</div>
    </section>

    ${podeCompartilhar ? `
    <div class="nao-imprimir" style="display:flex;flex-direction:column;gap:8px">
      <button type="button" class="btn btn-grande" id="compartilhar">${ICONES.compartilhar}Compartilhar</button>
      ${valido ? `<button type="button" class="btn btn-sec" id="baixar">${ICONES.baixar}Baixar PDF</button>` : ''}
      <div id="comp-msg" class="aviso" hidden role="status"></div>
    </div>` : ''}

    <div class="nao-imprimir acoes" style="justify-content:center">
      <a href="index.html" class="btn btn-sec">Voltar às salas</a>
      ${ehDono ? '<a href="minhas-reservas.html" class="btn btn-sec">Minhas reservas</a>' : ''}
    </div>`;

  document.getElementById('baixar')?.addEventListener('click', () => window.print());
  document.getElementById('compartilhar')?.addEventListener('click', async () => {
    const resultado = await compartilhar(linhas);
    const msg = document.getElementById('comp-msg');
    if (resultado === 'copiado') {
      msg.className = 'aviso aviso-ok';
      msg.textContent = 'Comprovante copiado. Cole no WhatsApp, no grupo da pastoral ou onde quiser.';
      msg.hidden = false;
    } else if (resultado === 'falhou') {
      msg.className = 'aviso aviso-info';
      msg.textContent = `Copie o endereço desta página para compartilhar: ${location.href}`;
      msg.hidden = false;
    }
  });
}

iniciar();
