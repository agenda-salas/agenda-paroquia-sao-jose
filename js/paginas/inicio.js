// Tela inicial: painel de salas
import { carregarSalas, carregarTurnos, carregarAgenda, carregarBloqueios, carregarConfig, nomeSala } from '../api.js';
import { montarPagina, avisoCache, escolherPerfil, faixaPerfil, perfilAtual } from '../ui.js';
import { hojeISO, somaDias, dataLonga, esc, ICONES } from '../util.js';
import { indexarAgenda, resumoSemana, situacaoAgora, situacaoTurno } from '../calendario.js';

let ctx, cfg, salas, soLivresHoje = false;

function quadro(s) {
  const sem = resumoSemana(ctx, s.id, cfg);
  const agora = situacaoAgora(ctx, s.id);
  const semana = sem.dias.map((d) => `<span class="c-${d.cor}" title="${esc(dataLonga(d.data))}">${d.letra}</span>`).join('');
  return `
    <a href="sala.html?id=${s.id}" class="sala">
      <div class="sala-topo">
        <span class="sala-nome">${esc(nomeSala(s))}</span>
        <span class="cap">${s.capacidade} pessoas</span>
      </div>
      <span class="selo ${agora.classe}">${esc(agora.texto)}</span>
      <div class="semana" aria-label="Disponibilidade dos próximos 7 dias">${semana}</div>
      <span class="livre-total">${sem.livres} turnos livres nos próximos 7 dias</span>
    </a>`;
}

function quadroDestaque(s) {
  const sem = resumoSemana(ctx, s.id, cfg);
  const agora = situacaoAgora(ctx, s.id);
  const semana = sem.dias.map((d) => `<span class="c-${d.cor}" title="${esc(dataLonga(d.data))}">${d.letra}</span>`).join('');
  return `
    <a href="sala.html?id=${s.id}" class="sala sala-destaque">
      <div class="esq">
        <span class="sobre">${s.tipo === 'palestra' ? 'Palestras' : 'Sala'} · aprovação da secretaria</span>
        <span class="sala-nome">${esc(nomeSala(s))}</span>
        <span style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--texto-2)">${ICONES.pessoas}até ${s.capacidade} pessoas</span>
          <span class="selo ${agora.classe}">${esc(agora.texto)}</span>
        </span>
      </div>
      <div class="dir">
        <div class="semana" aria-label="Disponibilidade dos próximos 7 dias">${semana}</div>
        <span class="livre-total">${sem.livres} de ${sem.total} turnos livres nos próximos 7 dias</span>
      </div>
      <span style="color:var(--azul)">${ICONES.seta}</span>
    </a>`;
}

function livreHoje(s) {
  const hoje = hojeISO();
  return ctx.turnos.some((t) => situacaoTurno(ctx, s.id, hoje, t).s === 'L');
}

function desenhar() {
  const lista = soLivresHoje ? salas.filter(livreHoje) : salas;
  const destaque = lista.filter((s) => s.controlada || s.tipo === 'palestra');
  const comuns = lista.filter((s) => !(s.controlada || s.tipo === 'palestra'));

  // Agrupa as salas comuns por capacidade (maior primeiro)
  const caps = [...new Set(comuns.map((s) => s.capacidade))].sort((a, b) => b - a);

  const legenda = `
    <div class="legenda">
      <span><i class="c-livre"></i>Livre</span>
      <span><i class="c-parcial"></i>Há turnos livres</span>
      <span><i class="c-cheio"></i>Sem turnos</span>
      <span><i class="c-off"></i>Bloqueada</span>
    </div>`;

  let html = '';
  if (destaque.length) {
    html += `
      <section class="secao" aria-labelledby="t-dest">
        <div class="secao-topo">
          <h2 id="t-dest">${destaque.length > 1 ? 'Salas com aprovação da secretaria' : destaque[0].tipo === 'palestra' ? 'Sala de palestra' : 'Sala com aprovação'}</h2>
          <span class="nota">Exige aprovação da secretaria · a reserva fica pendente por até ${esc(cfg.prazo_aprovacao_horas || 48)} h</span>
        </div>
        ${destaque.map(quadroDestaque).join('')}
      </section>`;
  }
  if (caps.length) {
    html += `
      <div class="secao-grupo${destaque.length ? ' secao-grupo-sep' : ''}">
        <h2 class="titulo-grupo">Salas sem aprovação da secretaria</h2>
        ${legenda}
      </div>`;
  } else {
    html += legenda;
  }
  for (const c of caps) {
    html += `
      <section class="secao" aria-labelledby="t-${c}">
        <div class="secao-topo">
          <h3 id="t-${c}" class="subtitulo-grupo">Salas para ${c} pessoas</h3>
          <span class="nota">${perfilAtual() === 'externo' ? 'Não paroquiano: aprovação da secretaria' : 'Reserva confirmada na hora'}</span>
        </div>
        <div class="grade-salas">${comuns.filter((s) => s.capacidade === c).map(quadro).join('')}</div>
      </section>`;
  }
  if (!lista.length) html += '<div class="vazio">Nenhuma sala livre hoje.</div>';
  document.getElementById('conteudo').innerHTML = html;
}

async function iniciar() {
  await montarPagina('salas');
  await escolherPerfil();
  faixaPerfil(document.getElementById('perfil'));
  document.getElementById('hoje').textContent = dataLonga(hojeISO());
  try {
    cfg = await carregarConfig();
    document.getElementById('janela').textContent = cfg.janela_dias || 15;
    const inicio = hojeISO(), fim = somaDias(inicio, 7);
    const [rs, rt, ra, rb] = await Promise.all([
      carregarSalas(), carregarTurnos(), carregarAgenda(inicio, fim), carregarBloqueios(inicio, fim),
    ]);
    salas = rs.dados;
    ctx = { turnos: rt.dados, indice: indexarAgenda(ra.dados), bloqueios: rb.dados };
    document.getElementById('cache').innerHTML = avisoCache(ra.deCache || rs.deCache);
    desenhar();
  } catch (e) {
    document.getElementById('conteudo').innerHTML = `<div class="vazio">Não foi possível carregar as salas. ${esc(e.message || '')}</div>`;
  }

  const bt = document.getElementById('filtro-hoje');
  bt.addEventListener('click', () => {
    soLivresHoje = !soLivresHoje;
    bt.setAttribute('aria-pressed', String(soLivresHoje));
    bt.textContent = soLivresHoje ? 'Mostrar todas as salas' : 'Salas livres hoje';
    if (salas) desenhar();
  });
}

iniciar();
