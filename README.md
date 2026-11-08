# Sistema de Reservas · Paróquia São José (Taguatinga Norte - DF)

PWA (site instalável no celular) em **HTML, CSS e JavaScript puros**, sem framework. Usa o **Supabase** como banco de dados, login e regras de segurança, e fica hospedado no **GitHub Pages**.

## Links

| Para quem | Link |
| --- | --- |
| Usuários (pastorais, não paroquianos, Direcionamento) | https://agenda-salas.github.io/agenda-paroquia-sao-jose/ |
| Reserva de barracas (pastorais) | https://agenda-salas.github.io/agenda-paroquia-sao-jose/barracas.html |
| Direcionamento Espiritual (link direto) | https://agenda-salas.github.io/agenda-paroquia-sao-jose/direcionamento.html |
| Área de Gestão (secretaria e Pároco) | https://agenda-salas.github.io/agenda-paroquia-sao-jose/secretaria.html |

## O que o sistema faz

1. **Reserva de salas** do Centro Catequético, por turno (Manhã, Tarde e Noite).
   - **Pastorais, grupos e movimentos** entram com o login criado pela secretaria.
   - **Não paroquianos** pedem sem login e acompanham o pedido por um link secreto.
   - Salas controladas e pedidos de não paroquianos ficam **pendentes** até a secretaria aprovar. Sem resposta em 48 h, expiram.
2. **Reserva de barracas** (aba "Barracas" na página de reservas, só para paroquianos).
   - 12 blocos com os meses do ano atual. Em cada mês, os finais de semana com sábado e domingo e os turnos Manhã, Tarde e Noite.
   - A pastoral marca os dias e os turnos que quer e pode deixar uma mensagem para a secretaria.
   - Uma barraca por turno. O pedido pendente já ocupa o turno. A secretaria aprova em até 48 h, senão o pedido expira.
   - Comprovante no mesmo modelo das salas, com código `BR-AAAA-NNNN`.
3. **Direcionamento Espiritual**: pedido de horário com o Pároco, sem login (terça para paroquianos, quinta para enfermos). Todo pedido é analisado pelo Pároco ou pela secretaria.
4. **Área de Gestão** (`secretaria.html`). Menu: **Solicitações ▾** (Aprovações com os bloqueios de salas, Direcionamento Espiritual, Barracas) · **Controles ▾** (Reservas, Salas, Usuários, Configurações, Alterar minha senha, Ver site de reservas) · Pastorais, Movimentos e Grupos · **Agenda**. Na primeira abertura do dia, o acólito mostra os compromissos de hoje e dos próximos 3 dias. Relatórios em PDF e Excel gerados no navegador.
   - O Pároco vê só Solicitações > Direcionamento Espiritual e Controles > Alterar minha senha.

## Acesso

- **Não existe cadastro livre.** A secretaria cria o login (e-mail) e a senha de cada pastoral na aba *Pastorais, Movimentos e Grupos*. Um mesmo e-mail pode servir a várias pastorais.
- **Secretaria e Pároco** têm contas próprias, registradas nas tabelas `administradores` e `parocos`.
- Na primeira visita, a pessoa escolhe: *Pastoral, Grupo ou Movimento*, *Não sou Paroquiano* ou *Direcionamento Espiritual*. A escolha fica guardada no aparelho até ela clicar em **Sair**.

## Estrutura

```
index.html             reserva de salas (painel) + aba Barracas
barracas.html          reserva de barracas (meses -> fins de semana -> turnos)
sala.html              agenda mensal da sala
reservar.html          formulário de reserva de sala
comprovante.html       comprovante (salas: ?c=SJ-…, ?t=link secreto; barracas: ?c=BR-…)
minhas-reservas.html   reservas da pastoral (salas, barracas, Direcionamento) + Baixar PDF
entrar.html            entrar e alterar senha
direcionamento.html    pedido de Direcionamento Espiritual
secretaria.html        Área de Gestão (login próprio)
atendimentos.html      redireciona para a aba Direcionamento da gestão
css/style.css          estilos (versão no link: style.css?v=32)
sw.js                  service worker, rede primeiro (VERSAO 'salas-sj-v43')
js/config.js           chaves do Supabase (NÃO vai no pacote; nunca alterar)
js/api.js              cliente Supabase e acesso aos dados das salas
js/barracas.js         acesso aos dados e textos das barracas
js/barracas-gestao.js  aba Barracas da gestão
js/ui.js               topo, menu, rodapé, sessão e tela de boas-vindas
js/util.js             datas, máscaras, WhatsApp e escapes
js/calendario.js       situação dos turnos das salas
js/comprovante.js      texto, link e compartilhar do comprovante
js/exportar.js         PDF/Excel e relatórios por período
js/secretaria.js       Área de Gestão
js/agenda-paroco.js    Direcionamento na gestão
js/pastorais.js        aba Pastorais
js/paginas/*.js        uma por página do site
supabase/              arquivos SQL (ver abaixo)
```

Ao mudar CSS ou JS, suba a versão do `style.css?v=` em todos os HTML e a `VERSAO` do `sw.js`.

## Banco de dados (Supabase)

Os arquivos ficam em `supabase/` e rodam no **SQL Editor**. A ordem está em `supabase/LEIA-ME-ORDEM.txt`.

- **Banco novo (vazio):** rode só `instalacao-completa.sql`, uma vez.
- **Banco em uso:** rode apenas os arquivos que ainda não foram executados, na ordem. Todos podem ser executados de novo sem perder dados.

Destaques:
- RLS em todas as tabelas. A secretaria (`is_admin()`) vê e altera tudo.
- Operações sensíveis são funções `SECURITY DEFINER` (criar reserva, pedir barraca, aprovar, cancelar, comprovante etc.).
- Barracas usam tabelas próprias (`barracas_reservas` e `barracas_bloqueios`), separadas das salas.
- `atualizacao-expiracao.sql` liga o **pg_cron** e expira os pedidos sem resposta a cada 15 minutos (salas e barracas).

### Ajustes no painel do Supabase

1. **Authentication > Sign In / Providers:** desligue **Allow new users to sign up**.
2. **Authentication > URL Configuration:** Site URL `https://agenda-salas.github.io/agenda-paroquia-sao-jose/` e, em Redirect URLs, `https://agenda-salas.github.io/agenda-paroquia-sao-jose/**`.
3. **Project Settings > API:** a Project URL e a chave *anon public* ficam em `js/config.js`. Nunca use a chave *service_role* no site.

### Contas da secretaria e do Pároco

Em **Authentication > Users > Add user > Create new user**, informe e-mail e senha e marque **Auto Confirm User**. Depois, no SQL Editor (troque o e-mail):

```sql
-- Secretaria
insert into administradores (user_id)
select id from auth.users where email = 'secretaria@exemplo.com';

-- Pároco
insert into parocos (user_id)
select id from auth.users where email = 'paroco@exemplo.com';
```

## Publicação

O site é publicado pelo GitHub Pages a partir da branch `main`, pasta `/ (root)`. O `js/config.js` publicado continua o mesmo.

## Testar no computador

Os arquivos usam módulos JavaScript, então precisam de um servidor:

```
python -m http.server 8000
```

Acesse http://localhost:8000 e adicione `http://localhost:8000/**` em Redirect URLs no Supabase.
