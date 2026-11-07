// Comprovante de barraca (código BR-AAAA-NNNN): mesmo modelo do comprovante das salas
import { sessao } from '../ui.js';
import { carregarConfig } from '../api.js';
import { esc, ICONES, hojeISO, dataLonga, param } from '../util.js';
import {
  obterComprovanteBarraca, cancelarMinhaBarraca, agruparBarracas, nomeTurnoBarraca, descreverDias,
  linkComprovanteBarraca, TEXTO_APROVACAO_BARRACA,
} from '../barracas.js';

const STATUS = {
  confirmada: { titulo: 'Reserva confirmada', cor: 'var(--verde-tx)', fundo: 'var(--verde-bg)', icone: 'ok' },
  realizada:  { titulo: 'Reserva realizada', cor: 'var(--verde-tx)', fundo: 'var(--verde-bg)', icone: 'ok' },
  pendente:   { titulo: 'Aguardando aprovação', cor: 'var(--pend-tx)', fundo: 'var(--pend-bg)', icone: 'relogio' },
  recusada:   { titulo: 'Reserva recusada', cor: 'var(--perigo)', fundo: '#FBEDED', icone: 'x' },
  cancelada:  { titulo: 'Reserva cancelada', cor: 'var(--perigo)', fundo: '#FBEDED', icone: 'x' },
  expirada:   { titulo: 'Pedido expirado', cor: 'var(--cinza-tx)', fundo: 'var(--cinza-bg)', icone: 'x' },
};

function textoCompartilhar(p) {
  return [
    `Comprovante de reserva ${p.codigo}`,
    'Paróquia São José · Reserva de barracas',
    '',
    `Pastoral: ${p.grupo}`,
    ...p.dias.map((d) => `${dataLonga(d.data)}: ${d.turnos.map(nomeTurnoBarraca).join(', ')}`),
    `Responsável: ${p.responsavel}`,
    '',
    p.status === 'pendente' ? 'Acompanhe a aprovação da secretaria:' : 'Confira a situação atual:',
  ].join('\n');
}

export async function mostrarBarraca(el, codigo) {
  let linhas;
  try {
    linhas = await obterComprovanteBarraca(codigo);
  } catch (e) {
    el.innerHTML = `<div class="vazio">Não foi possível abrir o comprovante. ${esc(e.message)}</div>`;
    return;
  }
  if (!linhas.length) { el.innerHTML = '<div class="vazio">Comprovante não encontrado. Confira o código.</div>'; return; }

  const [p] = agruparBarracas(linhas);
  p.responsavel = linhas[0].responsavel;
  const cfg = await carregarConfig().catch(() => ({}));
  const tel = cfg.telefone_secretaria || '(61) 3354-2921';
  const st = STATUS[p.status] || STATUS.pendente;
  const ativa = ['pendente', 'confirmada'].includes(p.status);
  const podeCancelar = ativa && (linhas[0].dono || sessao?.admin) && p.ultimaData >= hojeISO();
  const ehDono = !!linhas[0].dono;
  const novo = !!param('novo');

  let nota = '';
  if (p.status === 'pendente') nota = 'A secretaria vai analisar o pedido. Guarde este link: quando a reserva for aprovada, esta página mostrará o comprovante confirmado.';
  if (p.status === 'recusada') nota = `Motivo: ${esc(p.motivo_recusa || 'não informado')}.`;
  const FINAL = {
    recusada: 'Pedimos desculpas, mas não foi possível confirmar a reserva da barraca pelo motivo acima. Solicite outra data. Agradecemos a compreensão.',
    cancelada: 'Esta reserva foi cancelada e não é mais válida. Se ainda precisar da barraca, faça uma nova reserva. Agradecemos.',
    expirada: `O pedido não foi analisado dentro do prazo e o turno foi liberado. Se ainda precisar da barraca, faça uma nova reserva ou fale com a secretaria paroquial ${tel}. Agradecemos a compreensão.`,
  };
  const regras = FINAL[p.status] || (p.status === 'pendente' ? TEXTO_APROVACAO_BARRACA
    : 'Monte a barraca no turno reservado e deixe o espaço limpo e organizado ao final. Qualquer ocorrência, procure a secretaria da Paróquia no primeiro horário útil seguinte.');
  const dias = p.dias.map((d) => `${esc(dataLonga(d.data))}<br><span class="nota" style="font-weight:600">${esc(d.turnos.map(nomeTurnoBarraca).join(', '))}</span>`).join('<br>');

  el.innerHTML = `
    ${novo && p.status === 'pendente' ? '<div class="aviso aviso-ok nao-imprimir"><span><b>Pedido enviado.</b> A secretaria vai analisar e responder em até 48 horas.</span></div>' : ''}
    <div class="comp-marca">
      <img src="img/brasao.png" alt="Brasão da Paróquia São José" onerror="this.remove()">
      <div><b>Reserva de barracas</b><span style="font-weight:700">Paróquia São José</span></div>
    </div>

    <section class="comp-cartao">
      <div class="comp-cab">
        <span class="comp-icone" style="background:${st.fundo};color:${st.cor}">${ICONES[st.icone]}</span>
        <h1 style="font-size:21px">${st.titulo}</h1>
        <span class="nota">Código da reserva</span>
        <span class="comp-cod">${esc(p.codigo)}</span>
      </div>
      <dl class="comp-dados">
        <dt>Reserva</dt><dd>Barraca</dd>
        <dt>${p.dias.length > 1 ? 'Dias' : 'Dia'}</dt><dd>${dias}</dd>
        <dt>Pastoral</dt><dd>${esc(p.grupo)}</dd>
        <dt>Responsável</dt><dd>${esc(p.responsavel)}</dd>
        ${p.mensagem ? `<dt>Mensagem</dt><dd class="barr-msg" style="font-weight:600">${esc(p.mensagem)}</dd>` : ''}
      </dl>
      ${nota ? `<div class="comp-regras" style="background:${st.fundo};color:${st.cor};font-weight:600">${nota}</div>` : ''}
      <div class="comp-regras">${esc(regras)}</div>
    </section>

    ${ativa ? `
    <div class="nao-imprimir" style="display:flex;flex-direction:column;gap:8px">
      <button type="button" class="btn btn-grande" id="compartilhar">${ICONES.compartilhar}Compartilhar</button>
      ${p.status === 'confirmada' ? `<button type="button" class="btn btn-sec" id="baixar">${ICONES.baixar}Baixar PDF</button>` : ''}
      <div id="comp-msg" class="aviso" hidden role="status"></div>
    </div>` : ''}

    ${podeCancelar ? `
    <div class="nao-imprimir comp-gerir">
      <button type="button" class="btn btn-perigo btn-grande" style="flex:1" id="cancelar-barraca">Cancelar reserva</button>
    </div>
    <div id="gerir-msg" class="aviso nao-imprimir" hidden role="alert"></div>` : ''}

    <div class="nao-imprimir acoes" style="justify-content:center">
      <a href="barracas.html" class="btn btn-sec">Voltar às barracas</a>
      ${ehDono ? '<a href="minhas-reservas.html" class="btn btn-sec">Minhas reservas</a>' : ''}
    </div>`;

  document.getElementById('cancelar-barraca')?.addEventListener('click', async (e) => {
    if (!confirm(`Cancelar a reserva ${p.codigo} (${descreverDias(p.dias)})? Os turnos ficam livres para outras pastorais. Esta ação não pode ser desfeita.`)) return;
    e.target.disabled = true;
    try {
      await cancelarMinhaBarraca(p.codigo);
      location.replace(`comprovante.html?c=${encodeURIComponent(p.codigo)}`);
    } catch (err) {
      e.target.disabled = false;
      const m = document.getElementById('gerir-msg');
      m.className = 'aviso aviso-erro nao-imprimir';
      m.textContent = err.message;
      m.hidden = false;
    }
  });
  document.getElementById('baixar')?.addEventListener('click', () => window.print());
  document.getElementById('compartilhar')?.addEventListener('click', async () => {
    const texto = textoCompartilhar(p);
    const url = linkComprovanteBarraca(p.codigo);
    const msg = document.getElementById('comp-msg');
    if (navigator.share) {
      try { await navigator.share({ title: `Comprovante ${p.codigo}`, text: texto, url }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(`${texto}\n${url}`);
      msg.className = 'aviso aviso-ok';
      msg.textContent = 'Comprovante copiado. Cole no WhatsApp, no grupo da pastoral ou onde quiser.';
    } catch {
      msg.className = 'aviso aviso-info';
      msg.textContent = `Copie o endereço desta página para compartilhar: ${location.href}`;
    }
    msg.hidden = false;
  });
}
