// Aba "Pastorais e Movimentos" da Área de Gestão: cadastro dos coordenadores
// de pastorais, movimentos e grupos (incluir, alterar e excluir).
import { sb, limparErro } from './api.js';
import { esc, dataCurta, linkWhatsApp } from './util.js';

const $ = (id) => document.getElementById(id);
const COORD_VAZIO = () => ({ nome: '', telefone: '', email: '' });
const REUNIAO_VAZIA = () => ({ dia: '', local: '', horario: '', observacao: '' });

let pastorais = [];
let editando = null;            // id da pastoral em edição (null = nova)
let coords = [], reunioes = [];
let ligado = false;

function aviso(tipo, texto) {
  const el = $('msg');
  el.className = `aviso aviso-${tipo}`;
  el.innerHTML = `<span>${esc(texto)}</span>`;
  el.hidden = false;
}

// O WhatsApp usa o primeiro número do campo (pode haver "celular / fixo")
const primeiroFone = (t) => String(t || '').split('/')[0];
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------- lista
export async function carregarPastorais() {
  ligar();
  const [{ data, error }, { data: cfg }] = await Promise.all([
    sb.from('pastorais').select('id, numero, nome, coordenadores, reunioes, observacao, atualizado_em'),
    sb.from('configuracoes').select('chave, valor').eq('chave', 'pastorais_atualizadas_em'),
  ]);
  if (error) {
    $('pa-lista').innerHTML = '';
    throw new Error(`Não foi possível carregar as pastorais. Verifique se o arquivo pastorais.sql foi executado no Supabase. ${limparErro(error)}`);
  }
  pastorais = (data || []).sort((a, b) => (a.numero ?? 9999) - (b.numero ?? 9999) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const atualizada = cfg?.[0]?.valor;
  $('pa-resumo').textContent = `${pastorais.length} ${pastorais.length === 1 ? 'pastoral, movimento ou grupo' : 'pastorais, movimentos e grupos'}`
    + (atualizada ? ` · Atualizada em ${dataCurta(atualizada)}` : '');
  desenhar();
}

function desenhar() {
  const busca = semAcento($('pa-busca').value.trim());
  const lista = !busca ? pastorais : pastorais.filter((p) => semAcento([
    p.numero, p.nome, p.observacao,
    ...(p.coordenadores || []).flatMap((c) => [c.nome, c.telefone, c.email]),
  ].join(' ')).includes(busca));

  if (!lista.length) {
    $('pa-lista').innerHTML = `<div class="vazio">${busca ? 'Nenhuma pastoral encontrada.' : 'Nenhuma pastoral cadastrada.'}</div>`;
    return;
  }
  $('pa-lista').innerHTML = `<div class="grade-salas pa-grade">${lista.map(cartao).join('')}</div>`;
  $('pa-lista').querySelectorAll('[data-pa-alterar]').forEach((b) => b.addEventListener('click', () => abrir(Number(b.dataset.paAlterar))));
  $('pa-lista').querySelectorAll('[data-pa-excluir]').forEach((b) => b.addEventListener('click', () => excluir(Number(b.dataset.paExcluir))));
}

function cartao(p) {
  const co = p.coordenadores || [];
  const re = p.reunioes || [];
  return `
    <article class="cartao pa-cartao">
      <div class="sala-topo">
        <span class="sala-nome">${p.numero != null ? `<span class="pa-num">${String(p.numero).padStart(2, '0')}</span>` : ''}${esc(p.nome)}</span>
      </div>
      <div class="pa-sec">
        <span class="pa-rot">${co.length === 1 ? 'Coordenador' : 'Coordenadores'}</span>
        ${co.length ? `<ul class="pa-itens">${co.map((c) => `
          <li><b>${esc(c.nome)}</b>
            ${c.telefone ? `<br><a href="${linkWhatsApp(primeiroFone(c.telefone), '')}" target="_blank" rel="noopener">${esc(c.telefone)}</a>` : ''}
            ${c.email ? `<br><a href="mailto:${esc(c.email)}" class="pa-email">${esc(c.email)}</a>` : ''}
          </li>`).join('')}</ul>` : '<span class="nota">Nenhum coordenador informado.</span>'}
      </div>
      <div class="pa-sec">
        <span class="pa-rot">${re.length === 1 ? 'Reunião' : 'Reuniões'}</span>
        ${re.length ? `<ul class="pa-itens">${re.map((r) => `
          <li>${r.observacao ? `<b>${esc(r.observacao)}</b> · ` : ''}${esc(r.dia)}${r.horario ? `, ${esc(r.horario)}` : ''}${r.local ? `<br><span class="nota">${esc(r.local)}</span>` : ''}</li>`).join('')}</ul>`
          : '<span class="nota">Nenhuma reunião informada.</span>'}
      </div>
      ${p.observacao ? `<span class="nota">${esc(p.observacao)}</span>` : ''}
      <div class="acoes pa-acoes">
        <button type="button" class="btn btn-sec btn-peq" data-pa-alterar="${p.id}">Alterar</button>
        <button type="button" class="btn btn-perigo btn-peq" data-pa-excluir="${p.id}">Excluir</button>
      </div>
    </article>`;
}

// ---------------------------------------------------------------- incluir / alterar
function abrir(id) {
  const p = id ? pastorais.find((x) => x.id === id) : null;
  editando = p ? p.id : null;
  const f = $('f-pastoral');
  f.reset();
  f.numero.value = p ? (p.numero ?? '') : (Math.max(0, ...pastorais.map((x) => x.numero || 0)) + 1);
  f.nome.value = p?.nome || '';
  f.observacao.value = p?.observacao || '';
  coords = (p?.coordenadores || []).map((c) => ({ ...COORD_VAZIO(), ...c }));
  reunioes = (p?.reunioes || []).map((r) => ({ ...REUNIAO_VAZIA(), ...r }));
  if (!coords.length) coords.push(COORD_VAZIO());
  if (!reunioes.length) reunioes.push(REUNIAO_VAZIA());
  $('pa-titulo').textContent = p ? `Alterar ${p.nome}` : 'Nova pastoral';
  $('pa-erro').hidden = true;
  desenharLinhas();
  $('dlg-pastoral').showModal();
}

function campo(lista, n, c, rotulo, extra = '') {
  return `<input type="text" data-c="${c}" value="${esc(lista[n][c])}" placeholder="${rotulo}" aria-label="${rotulo}" ${extra}>`;
}

function desenharLinhas() {
  $('pa-coords').innerHTML = coords.map((_, n) => `
    <li class="pa-linha pa-linha-coord" data-n="${n}">
      ${campo(coords, n, 'nome', 'Nome', 'maxlength="80"')}
      ${campo(coords, n, 'telefone', 'Telefone', 'maxlength="60" inputmode="tel"')}
      ${campo(coords, n, 'email', 'E-mail', 'maxlength="120" inputmode="email"')}
      <button type="button" class="btn btn-perigo btn-peq" data-rem="${n}">Remover</button>
    </li>`).join('');
  $('pa-reunioes').innerHTML = reunioes.map((_, n) => `
    <li class="pa-linha pa-linha-reuniao" data-n="${n}">
      ${campo(reunioes, n, 'dia', 'Dia (ex.: 2º sábado)', 'maxlength="60"')}
      ${campo(reunioes, n, 'local', 'Local', 'maxlength="60"')}
      ${campo(reunioes, n, 'horario', 'Horário', 'maxlength="20"')}
      ${campo(reunioes, n, 'observacao', 'Observação', 'maxlength="80"')}
      <button type="button" class="btn btn-perigo btn-peq" data-rem="${n}">Remover</button>
    </li>`).join('');

  [['pa-coords', coords], ['pa-reunioes', reunioes]].forEach(([el, lista]) => {
    $(el).querySelectorAll('input').forEach((i) => i.addEventListener('input', () => {
      lista[Number(i.closest('li').dataset.n)][i.dataset.c] = i.value;
    }));
    $(el).querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => {
      lista.splice(Number(b.dataset.rem), 1);
      desenharLinhas();
    }));
  });
}

const limpo = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v || '').trim()]));
const vazio = (o) => Object.values(o).every((v) => !v);

async function salvar(e) {
  e.preventDefault();
  const f = $('f-pastoral');
  const erro = (t) => { $('pa-erro').textContent = t; $('pa-erro').hidden = false; };
  const nome = f.nome.value.trim();
  if (!nome) return erro('Informe o nome da pastoral, movimento ou grupo.');
  const numero = f.numero.value === '' ? null : Number(f.numero.value);
  if (numero !== null && !(numero > 0)) return erro('O número deve ser maior que zero.');
  if (pastorais.some((p) => p.id !== editando && semAcento(p.nome) === semAcento(nome))) return erro('Já existe uma pastoral com este nome.');

  const co = coords.map(limpo).filter((c) => !vazio(c));
  if (co.some((c) => !c.nome)) return erro('Informe o nome de cada coordenador (ou remova a linha).');
  if (co.some((c) => c.email && !/^\S+@\S+\.\S+$/.test(c.email))) return erro('Há um e-mail inválido.');
  const re = reunioes.map(limpo).filter((r) => !vazio(r));
  if (re.some((r) => !r.dia)) return erro('Informe o dia de cada reunião (ou remova a linha).');

  const dados = { numero, nome, coordenadores: co, reunioes: re, observacao: f.observacao.value.trim() || null };
  const bt = $('pa-salvar');
  bt.disabled = true;
  const { error } = editando
    ? await sb.from('pastorais').update(dados).eq('id', editando)
    : await sb.from('pastorais').insert(dados);
  bt.disabled = false;
  if (error) return erro(limparErro(error));
  $('dlg-pastoral').close();
  aviso('ok', editando ? `${nome}: dados alterados.` : `${nome}: incluída no cadastro.`);
  await carregarPastorais();
}

async function excluir(id) {
  const p = pastorais.find((x) => x.id === id);
  if (!p || !confirm(`Excluir "${p.nome}" do cadastro? Os coordenadores e as reuniões desta pastoral também serão apagados. As reservas já feitas não mudam.`)) return;
  const { error } = await sb.from('pastorais').delete().eq('id', id);
  if (error) return aviso('erro', limparErro(error));
  aviso('ok', `${p.nome}: excluída do cadastro.`);
  await carregarPastorais();
}

function ligar() {
  if (ligado) return;
  ligado = true;
  $('pa-nova').addEventListener('click', () => abrir(null));
  $('pa-busca').addEventListener('input', desenhar);
  $('pa-add-coord').addEventListener('click', () => {
    coords.push(COORD_VAZIO());
    desenharLinhas();
    $('pa-coords').querySelector('li:last-child input')?.focus();
  });
  $('pa-add-reuniao').addEventListener('click', () => {
    reunioes.push(REUNIAO_VAZIA());
    desenharLinhas();
    $('pa-reunioes').querySelector('li:last-child input')?.focus();
  });
  $('f-pastoral').addEventListener('submit', salvar);
  document.querySelector('[data-fechar-pastoral]').addEventListener('click', () => $('dlg-pastoral').close());
}
