// Service worker: guarda as telas para abrir sem internet.
// Os dados da agenda ficam guardados pelo próprio app (última agenda baixada).
const VERSAO = 'salas-sj-v23';
const ARQUIVOS = [
  './', './index.html', './sala.html', './entrar.html', './reservar.html', './comprovante.html', './minhas-reservas.html',
  './secretaria.html', './atendimentos.html', './direcionamento.html', './css/style.css?v=20',
  './js/config.js', './js/api.js', './js/util.js', './js/ui.js', './js/calendario.js', './js/comprovante.js',
  './js/paginas/inicio.js', './js/paginas/sala.js', './js/paginas/entrar.js', './js/paginas/reservar.js',
  './js/paginas/comprovante.js', './js/paginas/minhas.js', './js/paginas/direcionamento.js', './js/secretaria.js', './js/agenda-paroco.js',
  './img/brasao.png', './img/paroquia.png', './icons/icon-192.png', './icons/icon-512.png', './manifest.json', './manifest-gestao.json', './manifest-paroco.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Banco de dados e login: sempre pela rede
  if (url.hostname.endsWith('supabase.co')) return;

  // Páginas e arquivos do site: rede primeiro, cópia guardada se estiver sem internet
  if (url.origin === location.origin) {
    e.respondWith(
      // no-cache: sempre confirma com o servidor se há versão nova (evita misturar arquivos antigos e novos)
      fetch(req, { cache: 'no-cache' }).then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Bibliotecas e fontes externas: cópia guardada primeiro
  e.respondWith(
    caches.match(req).then((guardada) => guardada || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copia = res.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
      return res;
    }))
  );
});
