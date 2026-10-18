// Entrar, cadastro simples (e-mail e senha) e recuperação de senha
import { sb, limparErro } from '../api.js';
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

function aba(qual) {
  const entrar = qual === 'entrar';
  $('aba-entrar').setAttribute('aria-selected', String(entrar));
  $('aba-cadastro').setAttribute('aria-selected', String(!entrar));
  $('f-entrar').hidden = !entrar;
  $('f-cadastro').hidden = entrar;
  msg.hidden = true;
}

async function iniciar() {
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') {
      recuperando = true;
      $('f-entrar').hidden = true;
      $('f-cadastro').hidden = true;
      document.querySelector('.abas').hidden = true;
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
    const { error } = await sb.auth.updateUser({ password: f.senha.value });
    if (error) return mostrarAviso(msg, 'erro', limparErro(error));
    f.reset();
    mostrarAviso(msg, 'ok', 'Senha alterada. Use a nova senha nos próximos acessos.');
    setTimeout(() => { location.href = 'index.html'; }, 1800);
  });

  if (sessao && alterando && !recuperando) {
    document.querySelector('.abas').hidden = true;
    $('f-entrar').hidden = true;
    $('f-cadastro').hidden = true;
    $('f-nova').hidden = false;
    $('f-nova').querySelector('h1').textContent = 'Alterar minha senha';
    return;
  }
  if (alterando && !sessao) { /* sem login: mostra a tela de entrar normalmente */ }
  else if (sessao && !recuperando) { location.href = destino(); return; }

  $('aba-entrar').addEventListener('click', () => aba('entrar'));
  $('aba-cadastro').addEventListener('click', () => aba('cadastro'));
  if (param('cadastro')) aba('cadastro');

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
    if (!email) return mostrarAviso(msg, 'erro', 'Digite seu e-mail no campo acima e toque de novo em "Esqueci minha senha".');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return mostrarAviso(msg, 'erro', limparErro(error));
    mostrarAviso(msg, 'ok', 'Enviamos um link para criar uma nova senha. Confira seu e-mail.');
  });

  const fc = $('f-cadastro');
  fc.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fc.aceite.checked) return mostrarAviso(msg, 'erro', 'Marque a autorização de uso dos dados para continuar.');
    const bt = fc.querySelector('[type=submit]');
    bt.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: fc.email.value.trim(),
      password: fc.senha.value,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    bt.disabled = false;
    if (error) return mostrarAviso(msg, 'erro', limparErro(error));
    if (data.session) { location.href = destino(); return; }
    // Só acontece se a confirmação por e-mail estiver ligada no Supabase
    aba('entrar');
    $('f-entrar').email.value = fc.email.value.trim();
    mostrarAviso(msg, 'ok', 'Cadastro criado. Abra o link de confirmação que enviamos para o seu e-mail e depois entre com sua senha.');
  });

}

iniciar();
