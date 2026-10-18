// Formulário de reserva: nome, telefone e grupo informados a cada reserva
import { carregarSala, carregarTurnos, carregarAgenda, carregarBloqueios, carregarConfig, gruposUsados, criarReserva, nomeSala } from '../api.js';
import { montarPagina, exigirLogin, mostrarAviso, sessao, escolherPerfil, faixaPerfil, perfilAtual } from '../ui.js';
import { param, dataLonga, faixa, esc, mascaraTelefone, soDigitos } from '../util.js';
import { indexarAgenda, situacaoTurno, turnoReservavel } from '../calendario.js';

const $ = (id) => document.getElementById(id);
const salaId = Number(param('sala'));
const data = param('data');
const pedidos = (param('turnos') || '').split(',').filter(Boolean);
let sala, cfg = {}, enviando = false;
const CHAVE_EXTRAS = 'salas-sj:dados-outra-paroquia';

// Mostra ou esconde os campos de quem é de outra paróquia
function aplicarPerfil() {
  const f = $('form');
  const externo = perfilAtual() === 'externo';
  $('extras').hidden = !externo;
  ['endereco', 'paroquia', 'paroco'].forEach((n) => { f[n].required = externo; });
  if (externo) {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE_EXTRAS) || '{}');
      ['endereco', 'paroquia', 'paroco'].forEach((n) => { if (!f[n].value && d[n]) f[n].value = d[n]; });
    } catch {}
  }
  regra();
}

// Preenche com os dados da última reserva (podem ser alterados)
function preencherDados() {
  const f = $('form');
  const s = sessao.solicitante || {};
  f.nome.value = s.nome || '';
  f.telefone.value = s.telefone || '';
  f.grupo.value = s.grupo || '';
}

async function iniciar() {
  await montarPagina('salas');
  if (!exigirLogin()) return;
  if (!salaId || !/^\d{4}-\d{2}-\d{2}$/.test(data || '')) { location.href = 'index.html'; return; }
  $('voltar').href = `sala.html?id=${salaId}&data=${data}`;

  const f = $('form');
  mascaraTelefone(f.telefone);
  preencherDados();
  await escolherPerfil();
  faixaPerfil($('perfil'), aplicarPerfil);

  try {
    const [sl, c, rt, ra, rb, grupos] = await Promise.all([
      carregarSala(salaId), carregarConfig(), carregarTurnos(),
      carregarAgenda(data, data, salaId), carregarBloqueios(data, data, salaId), gruposUsados(),
    ]);
    sala = sl;
    cfg = c;
    if (!sala) { $('resumo').textContent = 'Sala não encontrada.'; return; }
    $('resumo').textContent = `${nomeSala(sala)} (${sala.capacidade} pessoas) · ${dataLonga(data)}`;
    $('lista-grupos').innerHTML = grupos.map((g) => `<option value="${esc(g)}"></option>`).join('');

    const ctx = { turnos: rt.dados, indice: indexarAgenda(ra.dados), bloqueios: rb.dados };
    $('turnos').innerHTML = ctx.turnos.map((t) => {
      const st = situacaoTurno(ctx, salaId, data, t);
      if (st.s === 'X') return `<label class="indisp"><input type="checkbox" disabled><b>${t.nome}</b><span>Não funciona</span></label>`;
      const livre = st.s === 'L' && turnoReservavel(data, t, cfg, sessao.admin);
      const rotulo = st.s === 'L' ? (livre ? faixa(t) : 'Fora do prazo') : st.s === 'P' ? 'Pendente' : st.s === 'B' ? 'Bloqueada' : 'Reservado';
      return `<label class="${livre ? '' : 'indisp'}">
        <input type="checkbox" name="turno" value="${t.codigo}" ${livre ? '' : 'disabled'} ${livre && pedidos.includes(t.codigo) ? 'checked' : ''}>
        <b style="${livre ? 'color:var(--azul)' : 'text-decoration:line-through'}">${t.nome}</b><span>${esc(rotulo)}</span>
      </label>`;
    }).join('');
    aplicarPerfil();
  } catch (e) {
    mostrarAviso($('msg'), 'erro', `Não foi possível carregar a reserva. ${e.message || ''}`);
  }

  // Limpar: desmarca turnos e apaga o motivo; mantém nome, telefone e grupo
  $('limpar').addEventListener('click', () => {
    f.querySelectorAll('input[name="turno"]').forEach((i) => { i.checked = false; });
    f.motivo.value = '';
    $('msg').hidden = true;
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (enviando) return;
    const turnos = [...f.querySelectorAll('input[name="turno"]:checked')].map((i) => i.value);
    if (!turnos.length) return mostrarAviso($('msg'), 'erro', 'Escolha pelo menos um turno.');
    if (!f.nome.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o nome do responsável.');
    if (soDigitos(f.telefone.value).length < 10) return mostrarAviso($('msg'), 'erro', 'Informe o telefone com DDD.');
    if (!f.grupo.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe a pastoral ou o grupo.');
    const externo = perfilAtual() === 'externo';
    if (externo) {
      if (!f.endereco.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o endereço.');
      if (!f.paroquia.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe a paróquia em que atua.');
      if (!f.paroco.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o nome do pároco responsável.');
      try {
        localStorage.setItem(CHAVE_EXTRAS, JSON.stringify({ endereco: f.endereco.value.trim(), paroquia: f.paroquia.value.trim(), paroco: f.paroco.value.trim() }));
      } catch {}
    }
    enviando = true;
    $('enviar').disabled = true;
    $('enviar').textContent = 'Enviando…';
    try {
      const codigo = await criarReserva({
        salaId, data, turnos,
        nome: f.nome.value.trim(),
        telefone: f.telefone.value.trim(),
        grupo: f.grupo.value.trim(),
        motivo: f.motivo.value.trim(),
        tipo: externo ? 'externo' : 'paroquiano',
        endereco: externo ? f.endereco.value.trim() : null,
        paroquia: externo ? f.paroquia.value.trim() : null,
        paroco: externo ? f.paroco.value.trim() : null,
      });
      location.href = `comprovante.html?c=${encodeURIComponent(codigo)}&novo=1`;
    } catch (err) {
      mostrarAviso($('msg'), 'erro', err.message);
      enviando = false;
      $('enviar').disabled = false;
      $('enviar').textContent = 'Solicitar reserva';
    }
  });
}

function regra() {
  let texto;
  if (sessao.admin) texto = 'Reserva feita pela secretaria: confirmada na hora.';
  else if (perfilAtual() === 'externo') texto = `Sua reserva será confirmada pela secretaria em no máximo ${cfg.prazo_aprovacao_horas || 48} horas.`;
  else if (sala?.controlada) texto = `Sala com aprovação da secretaria: sua reserva fica pendente por até ${cfg.prazo_aprovacao_horas || 48} h, até a secretaria aprovar.`;
  else texto = 'Sala comum: a reserva é confirmada na hora. Alterações e cancelamentos até o início do turno.';
  $('regra').innerHTML = `<span>${esc(texto)}</span>`;
}

iniciar();
