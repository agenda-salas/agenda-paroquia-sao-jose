// Formulário de reserva: nome, telefone e grupo informados a cada reserva
import { carregarSala, carregarTurnos, carregarAgenda, carregarBloqueios, carregarConfig, gruposUsados, nomesPastorais, criarReserva, solicitarReservaExterna, nomeSala, dadosDaMinhaReserva, alterarMinhaReserva } from '../api.js';
import { montarPagina, exigirLogin, mostrarAviso, sessao, escolherPerfil, faixaPerfil, perfilAtual } from '../ui.js';
import { param, dataLonga, faixa, esc, mascaraTelefone, soDigitos } from '../util.js';
import { indexarAgenda, situacaoTurno, turnoReservavel } from '../calendario.js';

const $ = (id) => document.getElementById(id);
const salaId = Number(param('sala'));
const data = param('data');
const pedidos = (param('turnos') || '').split(',').filter(Boolean);
let sala, cfg = {}, enviando = false;
let usarLista = false;                                        // paroquiano escolhe a pastoral na lista do cadastro
const alterando = (param('alterar') || '').toUpperCase();   // código da reserva que está sendo alterada
let antigas = [];                                             // turnos ativos da reserva antiga
const CHAVE_EXTRAS = 'salas-sj:dados-outra-paroquia';
const TEXTO_APROVACAO = 'Esta reserva depende de aprovação da secretaria, que deve ocorrer em até 48h. Não havendo retorno em até 12h antes do horário agendado, faça contato com a secretaria paroquial pelo telefone (61) 3354-2921, em horário comercial.';

// Conta de pastoral: o grupo é sempre uma das pastorais deste login
const minhas = () => (sessao && !sessao.admin && sessao.pastorais) || [];
const grupoFixo = () => (minhas().length === 1 ? minhas()[0] : null);
const variasPastorais = () => minhas().length > 1;
const ehExterno = () => !minhas().length && perfilAtual() === 'externo';

// Mostra ou esconde os campos de quem é de outra paróquia
function aplicarPerfil() {
  if (alterando) { regra(); return; }
  const f = $('form');
  const externo = ehExterno();
  // Pastoral com login: grupo fixo. Secretaria: lista de pastorais. Não paroquiano: digita o grupo.
  const fixo = grupoFixo();
  // Login de várias pastorais: escolhe em nome de qual reservar
  if (variasPastorais() && !f.grupo_lista.dataset.minhas) {
    f.grupo_lista.innerHTML = '<option value="">Escolha a pastoral</option>'
      + minhas().map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    f.grupo_lista.dataset.minhas = '1';
    $('campo-grupo-lista').querySelector('.nota').textContent = 'Este login é de mais de uma pastoral, movimento ou grupo. Escolha em nome de qual é a reserva.';
    $('campo-grupo-lista').querySelector('span').firstChild.textContent = 'Em nome de qual pastoral ';
    if (minhas().includes(sessao.solicitante?.grupo)) f.grupo_lista.value = sessao.solicitante.grupo;
  }
  const lista = (usarLista || variasPastorais()) && !externo && !fixo;
  $('campo-grupo-lista').hidden = !lista;
  $('campo-grupo-texto').hidden = lista;
  f.grupo_lista.required = lista;
  f.grupo.required = !lista;
  f.grupo.readOnly = !!fixo;
  if (fixo) f.grupo.value = fixo;
  $('extras').hidden = !externo;
  ['endereco', 'paroquia', 'paroco', 'motivo'].forEach((n) => { f[n].required = externo; });
  $('obrig-motivo').hidden = !externo;
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
  const s = sessao?.solicitante || {};
  f.nome.value = s.nome || '';
  f.telefone.value = s.telefone || '';
  f.grupo.value = s.grupo || '';
}

async function iniciar() {
  await montarPagina('salas');
  if (alterando && !exigirLogin()) return;
  if (!salaId || !/^\d{4}-\d{2}-\d{2}$/.test(data || '')) { location.href = 'index.html'; return; }
  $('voltar').href = `sala.html?id=${salaId}&data=${data}`;

  const f = $('form');
  mascaraTelefone(f.telefone);
  if (alterando) {
    // Modo alteração: os dados da reserva continuam os mesmos; só mudam o dia e os turnos
    try { antigas = (await dadosDaMinhaReserva(alterando)).filter((r) => ['pendente', 'confirmada'].includes(r.status)); } catch { antigas = []; }
    if (!antigas.length) {
      mostrarAviso($('msg'), 'erro', `A reserva ${alterando} não pode mais ser alterada.`);
      $('enviar').disabled = true;
      return;
    }
    f.querySelector('h1').textContent = 'Alterar reserva';
    $('enviar').textContent = 'Confirmar alteração';
    $('voltar').href = `comprovante.html?c=${encodeURIComponent(alterando)}`;
    $('voltar').lastChild.textContent = 'Voltar à reserva';
    [f.nome, f.telefone, f.grupo, f.grupo_lista, f.motivo].forEach((i) => { i.closest('label').hidden = true; i.required = false; });
    $('extras').hidden = true;
    $('limpar').hidden = true;
    $('perfil').innerHTML = `<span class="faixa-perfil">Alterando a reserva <b>${esc(alterando)}</b></span>`;
  } else {
    await escolherPerfil();
    // Pastoral, grupo ou movimento precisa do login; não paroquiano faz o pedido sem login
    if (perfilAtual() !== 'externo' && !exigirLogin()) return;
    preencherDados();
    faixaPerfil($('perfil'));
  }

  try {
    const [sl, c, rt, ra, rb, grupos, nomes] = await Promise.all([
      carregarSala(salaId), carregarConfig(), carregarTurnos(),
      carregarAgenda(data, data, salaId), carregarBloqueios(data, data, salaId), gruposUsados(),
      alterando ? [] : nomesPastorais(),
    ]);
    sala = sl;
    cfg = c;
    if (!sala) { $('resumo').textContent = 'Sala não encontrada.'; return; }
    $('resumo').textContent = `${nomeSala(sala)} (${sala.capacidade} pessoas) · ${dataLonga(data)}`;
    $('lista-grupos').innerHTML = grupos.map((g) => `<option value="${esc(g)}"></option>`).join('');
    if (nomes.length && !variasPastorais()) {
      usarLista = true;
      const ordem = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      f.grupo_lista.innerHTML = '<option value="">Selecione na lista</option>'
        + ordem.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      // Já vem marcada a pastoral da última reserva, se ela estiver na lista
      if (ordem.includes(f.grupo.value)) f.grupo_lista.value = f.grupo.value;
    }

    const ctx = { turnos: rt.dados, indice: indexarAgenda(ra.dados), bloqueios: rb.dados };
    // Na alteração, os turnos da própria reserva antiga contam como livres
    antigas.filter((o) => o.sala_id === salaId).forEach((o) => ctx.indice.delete(`${salaId}|${o.data}|${o.turnos.codigo}`));
    $('turnos').innerHTML = ctx.turnos.map((t) => {
      const st = situacaoTurno(ctx, salaId, data, t);
      if (st.s === 'X') return `<label class="indisp"><input type="checkbox" disabled><b>${t.nome}</b><span>Não funciona</span></label>`;
      const livre = st.s === 'L' && turnoReservavel(data, t, cfg, sessao?.admin);
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
    if (alterando) {
      enviando = true;
      $('enviar').disabled = true;
      $('enviar').textContent = 'Alterando…';
      try {
        const novo = await alterarMinhaReserva(alterando, data, turnos);
        location.href = `comprovante.html?c=${encodeURIComponent(novo)}&novo=1`;
      } catch (err) {
        mostrarAviso($('msg'), 'erro', `${err.message} A reserva ${alterando} continua valendo.`);
        enviando = false;
        $('enviar').disabled = false;
        $('enviar').textContent = 'Confirmar alteração';
      }
      return;
    }
    if (!f.nome.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o nome do responsável.');
    if (soDigitos(f.telefone.value).length < 10) return mostrarAviso($('msg'), 'erro', 'Informe o telefone com DDD.');
    const externo = ehExterno();
    const daLista = (usarLista || variasPastorais()) && !externo && !grupoFixo();
    const grupo = grupoFixo() || (daLista ? f.grupo_lista.value : f.grupo.value.trim());
    if (!grupo) return mostrarAviso($('msg'), 'erro', variasPastorais() ? 'Escolha em nome de qual pastoral, movimento ou grupo é a reserva.' : daLista ? 'Selecione a sua pastoral, grupo ou movimento na lista.' : 'Informe a pastoral ou o grupo.');
    if (externo) {
      if (!f.endereco.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o endereço.');
      if (!f.paroquia.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe a paróquia em que atua.');
      if (!f.paroco.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o nome do pároco responsável.');
      if (!f.motivo.value.trim()) return mostrarAviso($('msg'), 'erro', 'Informe o motivo da reserva.');
      try {
        localStorage.setItem(CHAVE_EXTRAS, JSON.stringify({ endereco: f.endereco.value.trim(), paroquia: f.paroquia.value.trim(), paroco: f.paroco.value.trim() }));
      } catch {}
    }
    enviando = true;
    $('enviar').disabled = true;
    $('enviar').textContent = 'Enviando…';
    try {
      if (externo && !sessao) {
        // Não paroquiano sem login: o comprovante abre pelo link secreto
        const token = await solicitarReservaExterna({
          salaId, data, turnos, nome: f.nome.value.trim(), telefone: f.telefone.value.trim(), grupo,
          motivo: f.motivo.value.trim(), endereco: f.endereco.value.trim(), paroquia: f.paroquia.value.trim(), paroco: f.paroco.value.trim(),
        });
        try { sessionStorage.setItem(`zap:${token}`, f.telefone.value.trim()); } catch {}   // para "Enviar para o meu WhatsApp"
        location.href = `comprovante.html?t=${encodeURIComponent(token)}&novo=1`;
        return;
      }
      const codigo = await criarReserva({
        salaId, data, turnos,
        nome: f.nome.value.trim(),
        telefone: f.telefone.value.trim(),
        grupo,
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
  if (alterando) {
    const aprovacao = sala?.controlada || antigas.some((o) => o.tipo === 'externo');
    texto = `A reserva ${alterando} será cancelada e substituída por esta, com um novo código. `
      + (aprovacao ? `A nova reserva passa de novo pela aprovação da secretaria (até ${cfg.prazo_aprovacao_horas || 48} horas).` : 'A nova reserva é confirmada na hora.')
      + ' Se o novo horário não estiver disponível, nada muda.';
  } else if (sessao?.admin) texto = 'Reserva feita pela secretaria: confirmada na hora.';
  else if (ehExterno() || sala?.controlada) texto = TEXTO_APROVACAO;
  else texto = 'Sala comum: a reserva é confirmada na hora. Alterações e cancelamentos até o início do turno.';
  $('regra').innerHTML = `<span>${esc(texto)}</span>`;
}

iniciar();
