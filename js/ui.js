// Cabeçalho, rodapé, sessão e registro do PWA (comum a todas as telas)
import { sb, carregarConfig } from './api.js';
import { esc, iniciais } from './util.js';

const raiz = document.querySelector('meta[name="raiz"]')?.content || '.';

export let sessao = null;     // { user, solicitante, admin }

export async function carregarSessao() {
  const { data } = await sb.auth.getSession();
  const user = data.session?.user || null;
  if (!user) { sessao = null; return null; }
  const [{ data: solicitante }, { data: admin }] = await Promise.all([
    sb.from('solicitantes').select('*').eq('id', user.id).maybeSingle(),
    sb.rpc('is_admin'),
  ]);
  sessao = { user, solicitante, admin: !!admin };
  return sessao;
}

export async function montarPagina(ativo) {
  await carregarSessao().catch(() => null);
  const nome = sessao?.solicitante?.nome || sessao?.user?.email || '';
  const conta = sessao
    ? `<span class="usuario" title="${esc(sessao.user.email)}"><span class="avatar">${esc(iniciais(nome))}</span>${esc(nome.split(' ')[0])}</span>
       <a href="${raiz}/entrar.html?alterar=1" class="${ativo === 'senha' ? 'ativo' : ''}">Alterar senha</a>
       <button type="button" id="sair">Sair</button>`
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
    await sb.auth.signOut();
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
// "paroquiano" ou "externo" (outra paróquia). Fica guardado neste aparelho.
const CHAVE_PERFIL = 'salas-sj:perfil';

export function perfilAtual() {
  try { return localStorage.getItem(CHAVE_PERFIL); } catch { return null; }
}

function guardarPerfil(v) {
  try { localStorage.setItem(CHAVE_PERFIL, v); } catch {}
}

export function nomePerfil(p) {
  return p === 'externo' ? 'Não paroquiano' : 'Paroquiano';
}

// Mostra as duas caixas de escolha. Com forcar = false, só pergunta se ainda não escolheu.
export function escolherPerfil(forcar = false) {
  const atual = perfilAtual();
  if (atual && !forcar) return Promise.resolve(atual);
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'perfil-dialogo';
    dlg.setAttribute('aria-labelledby', 'perfil-titulo');
    dlg.innerHTML = `
      <div class="perfil-cab">
        <img src="${raiz}/img/brasao.png" alt="" onerror="this.remove()">
        <h2 id="perfil-titulo">Como você vai reservar?</h2>
        <p class="nota">Escolha uma opção para continuar.</p>
      </div>
      <div class="perfil-opcoes">
        <button type="button" class="perfil-opcao" data-perfil="paroquiano">
          <b>Sou Paroquiano</b>
        </button>
        <button type="button" class="perfil-opcao" data-perfil="externo">
          <b>Não sou Paroquiano</b>
        </button>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('cancel', (e) => { if (!atual) e.preventDefault(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(perfilAtual()); });
    dlg.querySelectorAll('[data-perfil]').forEach((b) => b.addEventListener('click', () => {
      guardarPerfil(b.dataset.perfil);
      dlg.close();
    }));
    dlg.showModal();
  });
}

// Faixa "Você está reservando como ... · Trocar"
export function faixaPerfil(el, aoTrocar) {
  const desenhar = () => {
    const p = perfilAtual();
    el.innerHTML = p ? `<span class="faixa-perfil">Reservando como: <b>${nomePerfil(p)}</b>
      <button type="button" class="link-btn">Trocar</button></span>` : '';
    el.querySelector('button')?.addEventListener('click', async () => {
      await escolherPerfil(true);
      desenhar();
      if (aoTrocar) aoTrocar(perfilAtual());
    });
  };
  desenhar();
}
