-- =====================================================================
-- Reservas de salas - Paróquia São José
-- schema.sql — INSTALAÇÃO NOVA (banco vazio)
-- Execute no SQL Editor do Supabase, nesta ordem:
--   1) schema.sql   2) functions.sql   3) policies.sql
-- Banco que já tem as tabelas da versão anterior: use atualizacao-gestao.sql
-- no lugar deste arquivo e depois rode functions.sql e policies.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configurações (chave/valor) — editáveis na página de Gestão
-- ---------------------------------------------------------------------
create table if not exists configuracoes (
  chave  text primary key,
  valor  text not null,
  descricao text
);

insert into configuracoes (chave, valor, descricao) values
  ('antecedencia_min_horas', '6',  'Antecedência mínima para reservar (horas)'),
  ('janela_dias',            '15', 'Agenda aberta para os próximos N dias'),
  ('prazo_aprovacao_horas',  '48', 'Prazo para a secretaria aprovar antes de a pendência expirar'),
  ('texto_regras',           'Apresente este comprovante se solicitado. Alterações e cancelamentos até o início do turno. Deixe a sala organizada ao sair.', 'Regras impressas no comprovante'),
  ('telefone_secretaria',    '[TELEFONE DA SECRETARIA]', 'Exibido no rodapé')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Salas
-- ---------------------------------------------------------------------
create table if not exists salas (
  id          bigint generated always as identity primary key,
  numero      text not null unique,
  nome        text,
  capacidade  int  not null check (capacidade > 0),
  tipo        text not null default 'comum' check (tipo in ('comum','palestra')),
  controlada  boolean not null default false,   -- exige aprovação da secretaria
  ativa       boolean not null default true,
  ordem       int not null default 0,
  itens       jsonb not null default '[]',              -- itens da sala: [{"descricao": "Cadeiras", "quantidade": 30}]
  criado_em   timestamptz not null default now()
);

insert into salas (numero, nome, capacidade, tipo, controlada, ordem) values
  ('JB',  'Sala João Batista', 80, 'palestra', true, 0),
  ('01',  null, 50, 'comum', false, 1),
  ('02',  null, 50, 'comum', false, 2),
  ('07',  null, 50, 'comum', false, 7),
  ('08',  null, 50, 'comum', false, 8),
  ('107', null, 50, 'comum', false, 107),
  ('108', null, 50, 'comum', false, 108),
  ('09',  null, 15, 'comum', false, 9),
  ('10',  null, 15, 'comum', false, 10),
  ('11',  null, 15, 'comum', false, 11),
  ('12',  null, 15, 'comum', false, 12),
  ('13',  null, 15, 'comum', false, 13),
  ('14',  null, 15, 'comum', false, 14),
  ('109', null, 15, 'comum', false, 109),
  ('110', null, 15, 'comum', false, 110),
  ('111', null, 15, 'comum', false, 111),
  ('112', null, 15, 'comum', false, 112),
  ('113', null, 15, 'comum', false, 113),
  ('114', null, 15, 'comum', false, 114)
on conflict (numero) do nothing;

-- ---------------------------------------------------------------------
-- Secretaria (administradores)
-- Crie a conta em Authentication > Users > Add user (marque Auto Confirm) e rode:
--   insert into administradores (user_id) select id from auth.users where email = 'secretaria@exemplo.com';
-- ---------------------------------------------------------------------
create table if not exists administradores (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Solicitantes (coordenadores) — 1 linha por usuário do login.
-- Nome, telefone e grupo guardam os últimos usados, para preencher o formulário.
-- ---------------------------------------------------------------------
create table if not exists solicitantes (
  id               uuid primary key references auth.users(id) on delete cascade,
  nome             text not null default '',
  telefone         text not null default '',
  email            text not null,
  grupo            text,
  aceite_dados_em  timestamptz not null default now(),
  criado_em        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Turnos (grade configurável). dias_semana: 0 = domingo ... 6 = sábado
-- ---------------------------------------------------------------------
create table if not exists turnos (
  id           bigint generated always as identity primary key,
  codigo       text not null unique,           -- M / V / N
  nome         text not null,
  inicio       time not null,
  fim          time not null,
  dias_semana  int[] not null,
  ordem        int not null default 0
);

insert into turnos (codigo, nome, inicio, fim, dias_semana, ordem) values
  ('M', 'Manhã', '08:30', '12:00', '{0,1,2,3,4,5,6}', 1),
  ('V', 'Tarde', '14:00', '18:00', '{0,1,2,3,4,5,6}', 2),
  ('N', 'Noite', '19:00', '22:00', '{0,1,2,3,4,5,6}', 3)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- Recorrências (uso futuro)
-- ---------------------------------------------------------------------
create table if not exists recorrencias (
  id          bigint generated always as identity primary key,
  grupo       text,
  sala_id     bigint not null references salas(id),
  turno_id    bigint not null references turnos(id),
  dia_semana  int not null check (dia_semana between 0 and 6),
  inicio      date not null,
  fim         date not null check (fim <= inicio + 15),
  status      text not null default 'pendente' check (status in ('pendente','aprovada','recusada','encerrada')),
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reservas — nunca apagadas, só mudam de status.
-- Um pedido com vários turnos gera uma linha por turno com o MESMO código.
-- Nome, telefone e grupo são informados em cada reserva.
-- ---------------------------------------------------------------------
create sequence if not exists reserva_seq;

create table if not exists reservas (
  id                    bigint generated always as identity primary key,
  codigo                text not null,
  sala_id               bigint not null references salas(id),
  grupo                 text not null,
  responsavel_nome      text not null,
  responsavel_telefone  text not null,
  solicitante_id        uuid references solicitantes(id) on delete set null,
  data                  date not null,
  turno_id              bigint not null references turnos(id),
  motivo                text,
  status                text not null check (status in ('pendente','confirmada','recusada','cancelada','expirada','realizada','nao_compareceu')),
  recorrencia_id        bigint references recorrencias(id),
  aprovado_por          uuid references auth.users(id),
  aprovado_em           timestamptz,
  motivo_recusa         text,
  tipo                  text not null default 'paroquiano' check (tipo in ('paroquiano','externo')),
  endereco              text,
  paroquia_origem       text,
  paroco_responsavel    text,
  criado_em             timestamptz not null default now()
);

create index if not exists reservas_codigo_idx on reservas (codigo);
create index if not exists reservas_data_idx   on reservas (data);
create index if not exists reservas_solic_idx  on reservas (solicitante_id);

-- Impede reserva dupla: um turno de uma sala só tem uma reserva ativa
create unique index if not exists reservas_turno_unico
  on reservas (sala_id, data, turno_id)
  where status in ('pendente','confirmada','realizada','nao_compareceu');

-- ---------------------------------------------------------------------
-- Bloqueios (evento externo, manutenção). turnos = null bloqueia o dia todo
-- ---------------------------------------------------------------------
create table if not exists bloqueios (
  id           bigint generated always as identity primary key,
  sala_id      bigint not null references salas(id),
  data_inicio  date not null,
  data_fim     date not null check (data_fim >= data_inicio),
  turnos       text[],
  motivo       text not null,
  criado_por   uuid references auth.users(id),
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Agenda pública: só o necessário, sem nome, telefone nem e-mail (LGPD)
-- ---------------------------------------------------------------------
create or replace view agenda_publica as
select r.sala_id,
       r.data,
       t.codigo  as turno,
       r.status,
       r.grupo
from reservas r
join turnos t on t.id = r.turno_id
where r.status in ('pendente','confirmada','realizada','nao_compareceu');
