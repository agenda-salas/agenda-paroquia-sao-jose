// Entrar (login criado pela secretaria), alterar senha e recuperação de senha
import { sb, limparErro, alterarMinhaSenha } from '../api.js';
import { montarPagina, mostrarAviso, sessao } from '../ui.js';
import { param } from '../util.js';

const $ = (id) => document.getElementById(id);
const msg = $('msg');
const volta = param('volta');
let recuperando = false;

function destino() {
  // Só aceita voltar para páginas do próprio site
  return volta && volta.startsWith('/') && !volta.startsWith('//') ? volta : 'index.html';
}

async function iniciar() {
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') {
      recuperando = true;
      $('f-entrar').hidden = true;
      $('f-nova').hidden = false;
    }
  });

  const alterando = !!param('alterar');
  await montarPagina(alterando ? 'senha' : 'entrar');

  $('f-nova').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.senha.value.length < 6) return mostrarAviso(msg, 'erro', 'A senha precisa ter pelo menos 6 caracteres.');
    if (f.confirma && f.confirma.value !== f.senha.value) return mostrarAviso(msg, 'erro', 'As duas senhas não são iguais.');
    try {
      await alterarMinhaSenha(f.senha.value);
    } catch (err) {
      return mostrarAviso(msg, 'erro', err.message);
    }
    f.reset();
    mostrarAviso(msg, 'ok', 'Senha alterada. Use a nova senha nos próximos acessos.');
    setTimeout(() => { location.href = 'index.html'; }, 1800);
  });

  if (sessao && alterando && !recuperando) {
    $('f-entrar').hidden = true;
    $('f-nova').hidden = false;
    $('f-nova').querySelector('h1').textContent = 'Alterar minha senha';
    return;
  }
  if (alterando && !sessao) { /* sem login: mostra a tela de entrar normalmente */ }
  else if (sessao && !recuperando) { location.href = destino(); return; }


  $('f-entrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const bt = f.querySelector('[type=submit]');
    bt.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
    bt.disabled = false;
    if (error) return mostrarAviso(msg, 'erro', limparErro(error));
    location.href = destino();
  });

  $('esqueci').addEventListener('click', async () => {
    const email = $('f-entrar').email.value.trim();
    if (!email) return mostrarAviso(msg, 'erro', 'Digite o e-mail de acesso no campo acima e toque de novo em "Esqueci minha senha". Se o e-mail não chegar, peça a senha à secretaria paroquial.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return mostrarAviso(msg, 'erro', limparErro(error));
    mostrarAviso(msg, 'ok', 'Enviamos um link para criar uma nova senha. Confira o e-mail. Se não chegar, peça a senha à secretaria paroquial.');
  });

}

iniciar();
