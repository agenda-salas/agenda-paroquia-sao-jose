// Aviso diário do acólito: na primeira abertura da gestão no dia (por conta, em qualquer
// aparelho), o acólito "lê" os compromissos e as reservas de hoje e dos próximos 3 dias.
import { sb } from './api.js';
import { esc, hojeISO, somaDias, dataLonga } from './util.js';
import { carregarDiasAgenda, resumoDoDia } from './agenda-dados.js';

const $ = (id) => document.getElementById(id);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICONE = { compromisso: 'ag-c-comp', sala: 'ag-c-sala', barraca: 'ag-c-barr', direcionamento: 'ag-c-dir', bloqueio: 'ag-c-bloq' };

function rotuloDia(d, hoje) {
  if (d === hoje) return `Hoje · ${dataLonga(d)}`;
  if (d === somaDias(hoje, 1)) return `Amanhã · ${dataLonga(d)}`;
  return dataLonga(d);
}

function montarLista(dias, hoje) {
  const blocos = [];
  for (let i = 0; i < 4; i++) {
    const d = somaDias(hoje, i);
    const linhas = resumoDoDia(dias.get(d));
    if (!linhas.length) continue;
    blocos.push(`
      <section class="acol-dia acol-entra">
        <h3>${esc(rotuloDia(d, hoje))}</h3>
        <ul>${linhas.map((l) => `
          <li class="acol-entra${l.tipo === 'bloqueio' ? ' acol-bloq' : ''}">
            <i class="${ICONE[l.tipo]}" aria-hidden="true"></i>
            <span>${l.hora ? `<b>${esc(l.hora)}</b> · ` : ''}${esc(l.texto)}${l.aguardando ? ' <span class="etq etq-pend">aguardando</span>' : ''}${l.det ? `<small>${esc(l.det)}</small>` : ''}</span>
          </li>`).join('')}</ul>
      </section>`);
  }
  return blocos.length
    ? blocos.join('')
    : '<p class="acol-vazio acol-entra">Nenhum compromisso para hoje e os próximos 3 dias.</p>';
}

export async function verificarAvisoDiario({ abrirAgenda }) {
  // Só na primeira abertura do dia (o banco registra e responde true uma única vez)
  const { data: mostrar, error } = await sb.rpc('marcar_aviso_agenda');
  if (error || !mostrar) return;

  const hoje = hojeISO();
  let dias;
  try {
    dias = await carregarDiasAgenda(hoje, somaDias(hoje, 3));
  } catch {
    return;
  }

  const dlg = $('dlg-acolito');
  const hora = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }));
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  $('acol-sub').textContent = `${saudacao}! Estes são os compromissos de hoje e dos próximos 3 dias:`;
  $('acol-lista').innerHTML = montarLista(dias, hoje);
  $('acol-lista').hidden = true;
  $('acol-fim').hidden = true;
  $('acol-acoes').hidden = true;
  $('acol-digitando').hidden = false;

  $('acol-ok').onclick = () => dlg.close();
  $('acol-agenda').onclick = () => { dlg.close(); abrirAgenda(); };
  dlg.addEventListener('cancel', () => dlg.close(), { once: true });
  dlg.showModal();

  // "Lendo": pontinhos de digitando, depois os itens aparecem um a um
  const animar = !semMovimento();
  if (animar) await espera(1100);
  $('acol-digitando').hidden = true;
  const lista = $('acol-lista');
  lista.hidden = false;
  const itens = [...lista.querySelectorAll('.acol-entra'), $('acol-fim'), $('acol-acoes')];
  $('acol-fim').hidden = false;
  $('acol-acoes').hidden = false;
  if (!animar) return;
  itens.forEach((el) => el.classList.add('acol-oculto'));
  for (const el of itens) {
    if (!dlg.open) break;
    el.classList.remove('acol-oculto');
    el.classList.add('acol-mostra');
    await espera(el.tagName === 'SECTION' ? 160 : 120);
  }
  itens.forEach((el) => el.classList.remove('acol-oculto'));
  $('acol-ok').focus();
}
