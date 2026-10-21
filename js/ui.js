// Cabeçalho, rodapé, sessão e registro do PWA (comum a todas as telas)
import { sb, carregarConfig } from './api.js';
import { esc, iniciais } from './util.js';

const raiz = document.querySelector('meta[name="raiz"]')?.content || '.';

export let sessao = null;     // { user, solicitante, admin, pastoral }

export async function carregarSessao() {
  const { data } = await sb.auth.getSession();
  const user = data.session?.user || null;
  if (!user) { sessao = null; return null; }
  const [{ data: solicitante }, { data: admin }, { data: pastoral }] = await Promise.all([
    sb.from('solicitantes').select('*').eq('id', user.id).maybeSingle(),
    sb.rpc('is_admin'),
    sb.rpc('minha_pastoral'),
  ]);
  sessao = { user, solicitante, admin: !!admin, pastoral: (typeof pastoral === 'string' && pastoral) || null };
  return sessao;
}

export async function montarPagina(ativo) {
  await carregarSessao().catch(() => null);
  const nome = sessao?.pastoral || sessao?.solicitante?.nome || sessao?.user?.email || '';
  const conta = sessao
    ? `<span class="usuario" title="${esc(sessao.user.email)}"><span class="avatar">${esc(iniciais(nome))}</span>${esc(nome.split(' ')[0])}</span>
       <a href="${raiz}/entrar.html?alterar=1" class="${ativo === 'senha' ? 'ativo' : ''}">Alterar senha</a>
       <button type="button" id="sair">Sair</button>`
    : perfilAtual() === 'externo'
      ? '<button type="button" id="sair">Sair</button>'   // não paroquiano (sem login): volta à escolha inicial
      : `<a href="${raiz}/entrar.html?volta=${encodeURIComponent(location.pathname + location.search)}" class="btn-entrar">Entrar</a>`;

  const topo = document.createElement('header');
  topo.className = 'topo';
  topo.innerHTML = `
    <div class="topo-in">
      <a href="${raiz}/index.html" class="marca">
        <img src="${raiz}/img/brasao.png" alt="Brasão da Paróquia São José" onerror="this.remove()">
        <span class="marca-tx">
          <span class="marca-titulo">Sistema de Reservas</span>
          <span class="marca-sub">Paróquia São José - Taguatinga Norte - DF</span>
        </span>
      </a>
      <nav class="menu" aria-label="Principal">
        <a href="${raiz}/index.html" class="${ativo === 'salas' ? 'ativo' : ''}">Salas</a>
        ${sessao ? `<a href="${raiz}/minhas-reservas.html" class="${ativo === 'minhas' ? 'ativo' : ''}">Minhas reservas</a>` : ''}
        ${conta}
      </nav>
    </div>`;
  document.body.prepend(topo);

  const aviso = document.createElement('div');
  aviso.className = 'offline';
  aviso.hidden = navigator.onLine;
  aviso.id = 'aviso-offline';
  aviso.textContent = 'Sem internet: mostrando a última agenda baixada. Reservar exige conexão.';
  topo.after(aviso);
  addEventListener('online', () => { aviso.hidden = true; });
  addEventListener('offline', () => { aviso.hidden = false; });

  document.getElementById('sair')?.addEventListener('click', async () => {
    esquecerPerfil();   // ao sair, a escolha de acesso é feita de novo
    if (sessao) await sb.auth.signOut();
    location.href = `${raiz}/index.html`;
  });

  const cfg = await carregarConfig().catch(() => ({}));
  const rod = document.createElement('footer');
  rod.className = 'rodape';
  rod.innerHTML = `<div class="rodape-in">
      <span>Paróquia São José · Arquidiocese de Brasília</span>
      <span>Secretaria paroquial · ${esc(cfg.telefone_secretaria || '')}</span>
    </div>`;
  document.body.append(rod);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${raiz}/sw.js`).catch(() => {});
  }
  return sessao;
}

// Exige login; se não houver, manda para a tela de entrar e volta depois
export function exigirLogin() {
  if (!sessao) {
    location.href = `${raiz}/entrar.html?volta=${encodeURIComponent(location.pathname + location.search)}`;
    return false;
  }
  return true;
}

export function mostrarAviso(el, tipo, texto) {
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  el.hidden = false;
}

export function avisoCache(quando) {
  if (!quando) return '';
  const hh = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `<p class="nota">Dados de ${hh} (sem conexão).</p>`;
}

// ---------------------------------------------------------------- perfil
// "paroquiano" (pastoral, grupo ou movimento, com login) ou "externo" (não paroquiano, sem login).
// Vale até a pessoa clicar em Sair.
const CHAVE_PERFIL = 'salas-sj:perfil';

export function perfilAtual() {
  try { return localStorage.getItem(CHAVE_PERFIL); } catch { return null; }
}

function guardarPerfil(v) {
  try { localStorage.setItem(CHAVE_PERFIL, v); } catch {}
}

export function esquecerPerfil() {
  try { localStorage.removeItem(CHAVE_PERFIL); } catch {}
}

export function nomePerfil(p) {
  return p === 'externo' ? 'Não paroquiano' : 'Pastoral, grupo ou movimento';
}

const ICONE_PERFIL = {
  paroquiano: '<path d="M12 3v6M9 6h6"/><path d="M5 21V12l7-4 7 4v9"/><path d="M10 21v-5h4v5"/>',
  externo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  direcionamento: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>',
};
const icone = (k) => `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE_PERFIL[k]}</svg>`;

// Caixas de acesso. Só pergunta se ainda não escolheu; a escolha não muda até Sair.
export function escolherPerfil() {
  // Conta de pastoral conectada: não pergunta
  if (sessao && !sessao.admin) { guardarPerfil('paroquiano'); return Promise.resolve('paroquiano'); }
  const atual = perfilAtual();
  if (atual) return Promise.resolve(atual);
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'perfil-dialogo';
    dlg.setAttribute('aria-labelledby', 'perfil-titulo');
    dlg.innerHTML = `
      <div class="perfil-cab">
        <img src="${raiz}/img/brasao.png" alt="" onerror="this.remove()">
        <h2 id="perfil-titulo" tabindex="-1" autofocus style="outline:none">Bem-vindo</h2>
        <p class="nota">Escolha uma opção para continuar.</p>
      </div>
      <div class="perfil-opcoes">
        <button type="button" class="perfil-opcao" data-perfil="paroquiano">
          <span class="perfil-ic">${icone('paroquiano')}</span><span class="perfil-tx"><b>Pastoral, Grupo ou Movimento</b><span class="perfil-det">Entrar com o login da pastoral</span></span>
        </button>
        <button type="button" class="perfil-opcao" data-perfil="externo">
          <span class="perfil-ic">${icone('externo')}</span><span class="perfil-tx"><b>Não sou Paroquiano</b><span class="perfil-det">Pedido sem login, com aprovação</span></span>
        </button>
        <a class="perfil-opcao" href="${raiz}/direcionamento.html">
          <span class="perfil-ic">${icone('direcionamento')}</span><span class="perfil-tx"><b>Direcionamento Espiritual</b><span class="perfil-det">Pedir horário com o Pároco</span></span>
        </a>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    dlg.addEventListener('close', () => { dlg.remove(); resolve(perfilAtual()); });
    dlg.querySelectorAll('[data-perfil]').forEach((b) => b.addEventListener('click', () => {
      guardarPerfil(b.dataset.perfil);
      // Pastoral sem login: vai para a tela de entrar e volta para onde estava
      if (b.dataset.perfil === 'paroquiano' && !sessao) {
        location.href = `${raiz}/entrar.html?volta=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      dlg.close();
    }));
    dlg.showModal();
  });
}

// Faixa "Acesso: ..." (sem troca; para mudar, é preciso sair e entrar de novo)
export function faixaPerfil(el) {
  const p = perfilAtual();
  if (sessao?.pastoral) { el.innerHTML = `<span class="faixa-perfil">Pastoral: <b>${esc(sessao.pastoral)}</b></span>`; return; }
  el.innerHTML = p ? `<span class="faixa-perfil">Acesso: <b>${nomePerfil(p)}</b></span>` : '';
}
