# Sistema de Reservas - Paróquia São José

Sistema de reserva das salas do Centro Catequético. É um PWA em HTML, CSS e JavaScript puros, com o Supabase como banco de dados e login.

## Os dois links

| Para quem | Link |
| --- | --- |
| **Reservas** (coordenadores) | `https://agenda-salas.github.io/salas-sao-jose/` |
| **Gestão** (secretaria) | `https://agenda-salas.github.io/salas-sao-jose/secretaria.html` |
| **Direcionamento Espiritual** (Pároco e secretaria) | `https://agenda-salas.github.io/salas-sao-jose/atendimentos.html` |

## Paroquianos e outras paróquias

Ao abrir o site, a pessoa escolhe **Sou paroquiano** ou **Sou de outra paróquia** (a escolha fica guardada no aparelho e pode ser trocada). Quem é de outra paróquia informa também **endereço, paróquia em que atua e nome do pároco responsável**, e **toda reserva fica pendente** até a secretaria aprovar.

## Direcionamento Espiritual (agenda do Pároco)

Agenda semanal sem acesso público, usada pela secretaria e pelo Pároco:

- **Terça, 16h–18h:** paroquianos. Pessoas de outra paróquia ficam *aguardando a secretaria* até serem liberadas.
- **Quinta, 9h–11h30:** somente atendimento a enfermos (com endereço).
- Atendimentos de 30 minutos. Dias, horários e duração mudam em **Horários de atendimento**.
- Incluir, excluir, marcar como realizado, bloquear horários ou dias e avisar a pessoa pelo WhatsApp.
- A secretaria entra pelo botão **Atendimentos Pároco** na gestão. O Pároco entra direto pelo link.

### Conta do Pároco

1. Em **Authentication > Users > Add user > Create new user**, informe o e-mail e a senha do Pároco e marque **Auto Confirm User**.
2. No SQL Editor:

```sql
insert into parocos (user_id)
select id from auth.users where email = 'paroco@exemplo.com';
```

## Como funciona

- O coordenador cria o acesso só com e-mail e senha e entra na hora.
- Em cada reserva ele informa nome, telefone (WhatsApp) e pastoral ou grupo, que é texto livre. Os dados da última reserva já vêm preenchidos e podem ser alterados.
- Salas comuns são confirmadas na hora. A Sala João Batista (palestra) fica **pendente** até a secretaria aprovar; sem resposta em 48 h, o pedido expira.
- O comprovante tem link próprio e mostra sempre a situação atual. O botão **Compartilhar** abre o menu do celular (WhatsApp, grupo da pastoral etc.). No computador, ele copia o texto e o link.
- A agenda pública mostra só o nome do grupo. Nome, telefone e e-mail ficam visíveis apenas para a secretaria (LGPD).

## Gestão (secretaria.html)

Acesso só com e-mail e senha de uma conta cadastrada como secretaria. Abas:

- **Aprovações:** pedidos da Sala João Batista, com aprovar ou recusar (com motivo) e um link para avisar o responsável no WhatsApp.
- **Reservas:** lista por período, sala e situação, com busca. Ações: ver o comprovante, cancelar e marcar "não compareceu". O botão **Reservar para um grupo** abre o site: reservas da secretaria são confirmadas na hora, em qualquer sala e sem antecedência mínima.
- **Bloqueios:** bloqueia uma sala, ou todas, por período e turnos. Mostra as reservas afetadas, com aviso por WhatsApp e opção de cancelar.
- **Salas:** cadastro, alteração e ativação ou desativação.
- **Coordenadores:** contas cadastradas, com o nome, o telefone e o grupo da última reserva.
- **Configurações:** antecedência mínima, janela de dias, prazo de aprovação, telefone da secretaria e regras do comprovante.

## Estrutura

```
index.html             tela inicial (painel de salas)
sala.html              agenda mensal da sala
entrar.html            entrar, criar acesso e nova senha
reservar.html          formulário de reserva
comprovante.html       comprovante (link único: comprovante.html?c=SJ-2026-0001)
minhas-reservas.html   reservas do coordenador
secretaria.html        gestão (login próprio)
css/style.css          visual
js/                    config, banco (api), datas (util), cabeçalho (ui), calendário, comprovante, secretaria
js/paginas/            código de cada tela do site de reservas
img/  icons/           brasão, foto da paróquia e ícones do app
sw.js, manifest.json   PWA
supabase/              schema.sql, atualizacao-gestao.sql, functions.sql, policies.sql
```

## Instalação

### Banco novo (vazio)

No **SQL Editor** do Supabase, rode nesta ordem: `schema.sql`, `functions.sql`, `policies.sql` e `atendimentos.sql`.

### Banco que já está em uso (versão anterior)

Rode nesta ordem: `atualizacao-gestao.sql`, `functions.sql` e `policies.sql`. Não rode o `schema.sql`. A atualização não apaga salas, turnos, configurações nem reservas.

### Supabase

1. **Authentication > Sign In / Providers > Email:** desligue **Confirm email** e salve. Assim a pessoa cria o acesso e já entra.
2. **Authentication > URL Configuration:** Site URL `https://agenda-salas.github.io/salas-sao-jose/` e, em Redirect URLs, `https://agenda-salas.github.io/salas-sao-jose/**`.
3. **Project Settings > API:** copie a Project URL e a chave *anon public* para `js/config.js`. Nunca use a chave *service_role* no site.

### Conta da secretaria

1. Em **Authentication > Users > Add user > Create new user**, informe o e-mail e a senha e marque **Auto Confirm User**.
2. No SQL Editor, troque o e-mail e rode:

```sql
insert into administradores (user_id)
select id from auth.users where email = 'secretaria@exemplo.com';
```

3. Entre em `secretaria.html` com esse e-mail e senha.

Para tirar o acesso de alguém da gestão:

```sql
delete from administradores
where user_id = (select id from auth.users where email = 'secretaria@exemplo.com');
```

### GitHub Pages

Envie o conteúdo da pasta (com o seu `js/config.js`) para o repositório e, em **Settings > Pages**, use a branch `main`, pasta `/ (root)`.

## Regras configuradas

Ficam na aba **Configurações** da gestão:

| Regra | Valor inicial |
| --- | --- |
| Antecedência mínima | 6 h |
| Agenda aberta para | 15 dias |
| Prazo de aprovação | 48 h |

Turnos: Manhã 8h30–12h, Tarde 14h–18h e Noite 19h–22h (sem noite na sexta).

## Testar no computador

Os arquivos usam módulos JavaScript, então precisam de um servidor (não abra direto pelo arquivo):

```
python -m http.server 8000
```

Acesse http://localhost:8000 e adicione `http://localhost:8000/**` em Redirect URLs no Supabase.
