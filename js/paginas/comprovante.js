// Comprovante (link único): mostra sempre os dados atuais da reserva
import { obterComprovante, obterComprovanteToken, cancelarPorToken, dadosDaMinhaReserva, cancelarMinhaReserva } from '../api.js';
import { montarPagina, sessao } from '../ui.js';
import { param, dataLonga, faixa, esc, ICONES } from '../util.js';
import { compartilhar, TEXTO_ITENS } from '../comprovante.js';

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
  const token = param('t');            // link secreto dos pedidos feitos sem login
  if (!codigo && !token) { el.innerHTML = '<div class="vazio">Código do comprovante não informado.</div>'; return; }

  let linhas;
  try {
    linhas = token ? await obterComprovanteToken(token) : await obterComprovante(codigo);
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
  const ehDono = !!sessao && !token;

  // Cancelar/alterar: só o dono, reserva ativa e antes do início do turno
  let minhas = [];
  if (sessao && !token && ['pendente', 'confirmada'].includes(r.status)) {
    try { minhas = await dadosDaMinhaReserva(r.codigo); } catch { minhas = []; }
  }
  const ativas = minhas.filter((m) => ['pendente', 'confirmada'].includes(m.status));
  const comecou = (m) => new Date(`${m.data}T${m.turnos.inicio.slice(0, 5)}:00-03:00`).getTime() <= Date.now();
  const podeMexer = ativas.length > 0 && !ativas.some(comecou);
  // Pedido sem login: cancela pelo próprio link enquanto o turno não começou
  const comecouLinha = (l) => new Date(`${l.data}T${String(l.inicio).slice(0, 5)}:00-03:00`).getTime() <= Date.now();
  const podeCancelarLink = !!token && ['pendente', 'confirmada'].includes(r.status) && !linhas.some(comecouLinha);
  const novo = !!param('novo');

  let nota = '';
  if (r.status === 'pendente') nota = token
    ? 'A secretaria vai analisar o pedido. Guarde o link desta página: é por ele que você acompanha a resposta e, se precisar, cancela o pedido.'
    : 'A secretaria vai analisar o pedido. Guarde este link: quando a reserva for aprovada, esta página mostrará o comprovante confirmado.';
  if (r.status === 'recusada') nota = `Motivo: ${esc(r.motivo_recusa || 'não informado')}.`;

  // Reserva que não será usada: troca as orientações de uso por uma mensagem de encerramento
  const FINAL = {
    recusada: 'Pedimos desculpas, mas não foi possível confirmar sua reserva pelo motivo acima. Solicite um novo agendamento em outra data. Agradecemos a compreensão.',
    cancelada: 'Esta reserva foi cancelada e não é mais válida. Se ainda precisar do espaço, faça uma nova reserva. Agradecemos.',
    expirada: 'O pedido não foi analisado dentro do prazo e o horário foi liberado. Se ainda precisar do espaço, faça uma nova reserva ou fale com a secretaria paroquial. Agradecemos a compreensão.',
  };
  const semUso = !!FINAL[r.status];


  el.innerHTML = `
    ${token && novo ? `
    <div class="aviso aviso-info nao-imprimir comp-link-secreto">
      <span><b>Guarde este link.</b> Ele é secreto e é o único jeito de acompanhar e cancelar este pedido. Salve nos favoritos ou envie para você mesmo pelo WhatsApp.</span>
      <button type="button" class="btn btn-peq" id="copiar-link">Copiar link</button>
    </div>` : ''}
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
      ${!semUso && (r.itens || []).length ? `
      <div class="comp-itens">
        <p>${esc(TEXTO_ITENS)}</p>
        <ul>${r.itens.map((i) => `<li><span>${esc(i.descricao)}</span>${i.quantidade ? `<b>${esc(i.quantidade)}</b>` : ''}</li>`).join('')}</ul>
      </div>` : ''}
      ${nota ? `<div class="comp-regras" style="background:${st.fundo};color:${st.cor};font-weight:600">${nota}</div>` : ''}
      <div class="comp-regras">${esc(semUso ? FINAL[r.status] : (r.regras || ''))}</div>
    </section>

    ${podeCompartilhar ? `
    <div class="nao-imprimir" style="display:flex;flex-direction:column;gap:8px">
      <button type="button" class="btn btn-grande" id="compartilhar">${ICONES.compartilhar}Compartilhar</button>
      ${valido ? `<button type="button" class="btn btn-sec" id="baixar">${ICONES.baixar}Baixar PDF</button>` : ''}
      <div id="comp-msg" class="aviso" hidden role="status"></div>
    </div>` : ''}

    ${podeMexer ? `
    <div class="nao-imprimir comp-gerir">
      <a class="btn btn-grande" style="flex:1" href="sala.html?id=${ativas[0].sala_id}&data=${ativas[0].data}&alterar=${encodeURIComponent(r.codigo)}">Alterar reserva</a>
      <button type="button" class="btn btn-perigo btn-grande" style="flex:1" id="cancelar-reserva">Cancelar reserva</button>
    </div>
    <div id="gerir-msg" class="aviso nao-imprimir" hidden role="alert"></div>` : ''}

    ${podeCancelarLink ? `
    <div class="nao-imprimir comp-gerir">
      <button type="button" class="btn btn-perigo btn-grande" style="flex:1" id="cancelar-link">Cancelar pedido</button>
    </div>
    <div id="gerir-msg" class="aviso nao-imprimir" hidden role="alert"></div>` : ''}

    <div class="nao-imprimir acoes" style="justify-content:center">
      <a href="index.html" class="btn btn-sec">Voltar às salas</a>
      ${ehDono ? '<a href="minhas-reservas.html" class="btn btn-sec">Minhas reservas</a>' : ''}
    </div>`;

  document.getElementById('cancelar-reserva')?.addEventListener('click', async (e) => {
    if (!confirm(`Cancelar a reserva ${r.codigo}? O turno fica livre para outros grupos. Esta ação não pode ser desfeita.`)) return;
    e.target.disabled = true;
    try {
      await cancelarMinhaReserva(r.codigo);
      location.reload();
    } catch (err) {
      e.target.disabled = false;
      const m = document.getElementById('gerir-msg');
      m.className = 'aviso aviso-erro nao-imprimir';
      m.textContent = err.message;
      m.hidden = false;
    }
  });
  document.getElementById('cancelar-link')?.addEventListener('click', async (e) => {
    if (!confirm(`Cancelar o pedido ${r.codigo}? O horário fica livre para outros grupos. Esta ação não pode ser desfeita.`)) return;
    e.target.disabled = true;
    try {
      await cancelarPorToken(token);
      location.replace(`comprovante.html?t=${encodeURIComponent(token)}`);
    } catch (err) {
      e.target.disabled = false;
      const m = document.getElementById('gerir-msg');
      m.className = 'aviso aviso-erro nao-imprimir';
      m.textContent = err.message;
      m.hidden = false;
    }
  });
  document.getElementById('copiar-link')?.addEventListener('click', async (e) => {
    const link = location.href.replace(/&novo=1/, '');
    try {
      await navigator.clipboard.writeText(link);
      e.target.textContent = 'Link copiado';
    } catch {
      e.target.closest('.comp-link-secreto').querySelector('span').innerHTML += `<br><span class="pa-email">${esc(link)}</span>`;
      e.target.hidden = true;
    }
  });
  document.getElementById('baixar')?.addEventListener('click', () => window.print());
  document.getElementById('compartilhar')?.addEventListener('click', async () => {
    const resultado = await compartilhar(linhas, token);
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
