// Aba "Pastorais e Movimentos" da Área de Gestão: cadastro dos coordenadores
// de pastorais, movimentos e grupos (incluir, alterar e excluir).
import { sb, limparErro } from './api.js';
import { esc, dataCurta, linkWhatsApp } from './util.js';
import { baixarPDF, baixarExcel, escolherFormato, hojeArquivo } from './exportar.js';

const $ = (id) => document.getElementById(id);
const COORD_VAZIO = () => ({ nome: '', telefone: '', email: '' });
const REUNIAO_VAZIA = () => ({ dia: '', local: '', horario: '', observacao: '' });

let pastorais = [];
let editando = null;            // id da pastoral em edição (null = nova)
let coords = [], reunioes = [];
let ligado = false;
let atualizadaEm = '';

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
    sb.from('pastorais').select('id, numero, nome, coordenadores, reunioes, observacao, atualizado_em, login_email, senha_acesso, user_id'),
    sb.from('configuracoes').select('chave, valor').eq('chave', 'pastorais_atualizadas_em'),
  ]);
  if (error) {
    $('pa-lista').innerHTML = '';
    throw new Error(`Não foi possível carregar as pastorais. Verifique se o arquivo pastorais.sql foi executado no Supabase. ${limparErro(error)}`);
  }
  pastorais = (data || []).sort((a, b) => (a.numero ?? 9999) - (b.numero ?? 9999) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const atualizada = cfg?.[0]?.valor;
  atualizadaEm = atualizada ? dataCurta(atualizada) : '';
  $('pa-resumo').textContent = `${pastorais.length} ${pastorais.length === 1 ? 'pastoral, movimento ou grupo' : 'pastorais, movimentos e grupos'}`
    + (atualizada ? ` · Atualizada em ${dataCurta(atualizada)}` : '');
  desenhar();
}

function desenhar() {
  const busca = semAcento($('pa-busca').value.trim());
  const lista = !busca ? pastorais : pastorais.filter((p) => semAcento([
    p.numero, p.nome, p.observacao, p.login_email,
    ...(p.coordenadores || []).flatMap((c) => [c.nome, c.telefone, c.email]),
  ].join(' ')).includes(busca));

  if (!lista.length) {
    $('pa-lista').innerHTML = `<div class="vazio">${busca ? 'Nenhuma pastoral encontrada.' : 'Nenhuma pastoral cadastrada.'}</div>`;
    return;
  }
  $('pa-lista').innerHTML = `<div class="grade-salas pa-grade">${lista.map(cartao).join('')}</div>`;
  $('pa-lista').querySelectorAll('[data-pa-alterar]').forEach((b) => b.addEventListener('click', () => abrir(Number(b.dataset.paAlterar))));
  $('pa-lista').querySelectorAll('[data-pa-excluir]').forEach((b) => b.addEventListener('click', () => excluir(Number(b.dataset.paExcluir))));
  $('pa-lista').querySelectorAll('[data-pa-remover]').forEach((b) => b.addEventListener('click', () => removerAcesso(Number(b.dataset.paRemover))));
  $('pa-lista').querySelectorAll('[data-pa-mostrar]').forEach((b) => b.addEventListener('click', () => {
    const el = b.parentElement.querySelector('.pa-senha-valor');
    const ver = b.getAttribute('aria-pressed') !== 'true';
    el.textContent = ver ? el.dataset.senha : '••••••••';
    b.setAttribute('aria-pressed', String(ver));
    b.textContent = ver ? 'Ocultar' : 'Mostrar';
  }));
}

// Outras pastorais que usam o mesmo login (mesma conta, mesma senha)
function outrasDoLogin(p, email) {
  const e = (email ?? p?.login_email ?? '').trim().toLowerCase();
  if (!e) return [];
  return pastorais.filter((x) => x.id !== p?.id && (x.login_email || '').toLowerCase() === e).map((x) => x.nome);
}

function avisoLoginCompartilhado() {
  const f = $('f-pastoral');
  const atual = pastorais.find((x) => x.id === editando) || null;
  const outras = outrasDoLogin(atual || { id: null }, f.login_email.value);
  const el = $('pa-login-aviso');
  el.hidden = !outras.length;
  el.textContent = outras.length
    ? `Este login também é usado por: ${outras.join(', ')}. A senha é a mesma para todas: ao alterar aqui, ela muda em todas.`
    : '';
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
      <div class="pa-sec pa-login">
        <span class="pa-rot">Acesso ao sistema</span>
        ${p.user_id ? `
          <span><b>Login:</b> <span class="pa-email">${esc(p.login_email)}</span></span>
          ${outrasDoLogin(p).length ? `<span class="nota">Mesmo login de: ${esc(outrasDoLogin(p).join(', '))}</span>` : ''}
          <span class="pa-senha-linha"><b>Senha:</b> <span class="pa-senha-valor" data-senha="${esc(p.senha_acesso || '')}">••••••••</span>
            <button type="button" class="btn btn-sec btn-peq" data-pa-mostrar aria-pressed="false">Mostrar</button></span>`
          : '<span class="etq etq-bloq" style="align-self:flex-start">Sem acesso</span>'}
      </div>
      <div class="acoes pa-acoes">
        <button type="button" class="btn btn-sec btn-peq" data-pa-alterar="${p.id}">Alterar</button>
        ${p.user_id ? `<button type="button" class="btn btn-sec btn-peq" data-pa-remover="${p.id}">Remover acesso</button>` : ''}
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
  f.login_email.value = p?.login_email || '';
  f.senha_acesso.value = p?.senha_acesso || '';
  verSenha(false);
  avisoLoginCompartilhado();
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

  const login = f.login_email.value.trim().toLowerCase();
  const senha = f.senha_acesso.value;
  const atual = pastorais.find((p) => p.id === editando);
  if (login || senha) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) return erro('Informe um e-mail válido para o login.');
    if (senha.length < 6) return erro('A senha de acesso precisa ter pelo menos 6 caracteres.');
    const outras = outrasDoLogin(atual || { id: null }, login);
    const senhaOutras = outras.length && pastorais.find((x) => x.id !== atual?.id && (x.login_email || '').toLowerCase() === login)?.senha_acesso;
    if (outras.length && senhaOutras && senhaOutras !== senha
        && !confirm(`Este login também é usado por: ${outras.join(', ')}. A senha nova passa a valer para todas. Continuar?`)) return;
  } else if (atual?.user_id && !confirm(`Login e senha em branco: o acesso de "${atual.nome}" ao sistema será removido. Continuar?`)) {
    return;
  }

  const dados = { numero, nome, coordenadores: co, reunioes: re, observacao: f.observacao.value.trim() || null };
  const bt = $('pa-salvar');
  bt.disabled = true;
  try {
    if (editando) {
      const { error } = await sb.from('pastorais').update(dados).eq('id', editando);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('pastorais').insert(dados).select('id').single();
      if (error) throw error;
      editando = data.id;            // se o acesso falhar, salvar de novo só atualiza
    }
    // Login e senha: cria, altera ou remove a conta da pastoral
    const mudou = login !== (atual?.login_email || '') || senha !== (atual?.senha_acesso || '');
    if (login && (mudou || !atual?.user_id)) {
      const { error } = await sb.rpc('salvar_acesso_pastoral', { p_pastoral: editando, p_email: login, p_senha: senha });
      if (error) throw error;
    } else if (!login && atual?.user_id) {
      const { error } = await sb.rpc('remover_acesso_pastoral', { p_pastoral: editando });
      if (error) throw error;
    }
  } catch (err) {
    bt.disabled = false;
    await carregarPastorais().catch(() => {});
    return erro(limparErro(err));
  }
  bt.disabled = false;
  $('dlg-pastoral').close();
  aviso('ok', atual ? `${nome}: dados alterados.` : `${nome}: incluída no cadastro.`);
  await carregarPastorais();
}

async function removerAcesso(id) {
  const p = pastorais.find((x) => x.id === id);
  const outras = outrasDoLogin(p);
  if (!p || !confirm(outras.length
    ? `Remover o acesso de "${p.nome}"? O login ${p.login_email} continua valendo para: ${outras.join(', ')}. As reservas já feitas continuam.`
    : `Remover o acesso de "${p.nome}"? O login ${p.login_email} deixa de funcionar e quem estiver conectado sai. As reservas já feitas continuam.`)) return;
  const { error } = await sb.rpc('remover_acesso_pastoral', { p_pastoral: id });
  if (error) return aviso('erro', limparErro(error));
  aviso('ok', `${p.nome}: acesso removido.`);
  await carregarPastorais();
}

function verSenha(ver) {
  const i = $('f-pastoral').senha_acesso;
  i.type = ver ? 'text' : 'password';
  $('pa-ver-senha').setAttribute('aria-pressed', String(ver));
  $('pa-ver-senha').textContent = ver ? 'Ocultar' : 'Mostrar';
}

async function excluir(id) {
  const p = pastorais.find((x) => x.id === id);
  if (!p || !confirm(`Excluir "${p.nome}" do cadastro? Os coordenadores, as reuniões e o login de acesso desta pastoral também serão apagados. As reservas já feitas não mudam.`)) return;
  const { error } = await sb.from('pastorais').delete().eq('id', id);
  if (error) return aviso('erro', limparErro(error));
  aviso('ok', `${p.nome}: excluída do cadastro.`);
  await carregarPastorais();
}

// ---------------------------------------------------------------- baixar relação (sem login e senha)
const num = (p) => (p.numero != null ? String(p.numero).padStart(2, '0') : '');
const textoReuniao = (r) => [r.observacao, r.dia, r.horario, r.local].filter(Boolean).join(' · ');

async function baixarRelacao(formato) {
  const lista = pastorais;   // sempre a lista completa
  const sub = `${lista.length} pastorais, movimentos e grupos${atualizadaEm ? ` · Atualizada em ${atualizadaEm}` : ''}`;
  if (formato === 'pdf') {
    return baixarPDF({
      arquivo: `pastorais-movimentos-grupos-${hojeArquivo()}`,
      titulo: 'Pastorais, Movimentos e Grupos',
      subtitulo: sub,
      secoes: [{
        colunas: ['Nº', 'Pastoral / Movimento / Grupo', 'Coordenadores', 'Telefone', 'E-mail', 'Reuniões', 'Observação'],
        larguras: { 0: 10, 1: 40, 2: 40, 3: 30, 4: 55, 5: 60 },
        linhas: lista.map((p) => {
          const co = p.coordenadores || [];
          return [num(p), p.nome, co.map((c) => c.nome).join('\n'), co.map((c) => c.telefone || '—').join('\n'),
            co.map((c) => c.email || '—').join('\n'), (p.reunioes || []).map(textoReuniao).join('\n'), p.observacao || ''];
        }),
      }],
    });
  }
  // Excel: uma linha por coordenador, para filtrar e ordenar
  const linhas = [];
  lista.forEach((p) => {
    const reunioes = (p.reunioes || []).map(textoReuniao).join('; ');
    const co = (p.coordenadores || []).length ? p.coordenadores : [{}];
    co.forEach((c) => linhas.push([p.numero ?? '', p.nome, c.nome || '', c.telefone || '', c.email || '', reunioes, p.observacao || '']));
  });
  return baixarExcel({
    arquivo: `pastorais-movimentos-grupos-${hojeArquivo()}`,
    abas: [{ nome: 'Pastorais', colunas: ['Nº', 'Pastoral / Movimento / Grupo', 'Coordenador', 'Telefone', 'E-mail', 'Reuniões', 'Observação'],
      larguras: [6, 32, 30, 26, 34, 60, 30], linhas }],
  });
}

function ligar() {
  if (ligado) return;
  ligado = true;
  $('pa-nova').addEventListener('click', () => abrir(null));
  $('pa-baixar').addEventListener('click', () => escolherFormato('Baixar relação de pastorais', baixarRelacao));
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
  $('f-pastoral').login_email.addEventListener('input', avisoLoginCompartilhado);
  $('f-pastoral').login_email.addEventListener('change', () => {
    // Login já usado por outra pastoral: traz a senha dessa conta
    const e = $('f-pastoral').login_email.value.trim().toLowerCase();
    const outra = pastorais.find((x) => x.id !== editando && (x.login_email || '').toLowerCase() === e && x.senha_acesso);
    if (outra && !$('f-pastoral').senha_acesso.value) $('f-pastoral').senha_acesso.value = outra.senha_acesso;
  });
  $('pa-ver-senha').addEventListener('click', () => verSenha($('pa-ver-senha').getAttribute('aria-pressed') !== 'true'));
  document.querySelector('[data-fechar-pastoral]').addEventListener('click', () => $('dlg-pastoral').close());
}
