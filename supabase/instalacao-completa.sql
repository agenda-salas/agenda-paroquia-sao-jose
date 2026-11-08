-- =====================================================================
-- INSTALAÇÃO COMPLETA · Sistema de Reservas · Paróquia São José
-- Todos os arquivos da pasta supabase/, na ordem certa. Rode no SQL Editor do Supabase.
-- Use em um banco NOVO (vazio), uma única vez. Num banco que já está em uso, rode só os arquivos novos.
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> schema.sql

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> functions.sql

-- =====================================================================
-- functions.sql — regras de negócio no servidor (RPC)
-- Execute depois de schema.sql (instalação nova) ou de
-- atualizacao-gestao.sql (banco já instalado). Pode ser executado de novo.
-- =====================================================================

-- Remove versões anteriores (assinaturas antigas e novas)
drop function if exists criar_reserva(bigint, date, text[], bigint, text, text);
drop function if exists criar_reserva(bigint, date, text[], text, text, text, text);
drop function if exists criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text);
drop function if exists obter_comprovante(text);
drop function if exists decidir_reserva(text, boolean, text);
drop function if exists expirar_pendentes();
drop function if exists grupos_usados();
drop function if exists excluir_coordenador(uuid);
drop function if exists definir_senha(uuid, text);

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from administradores where user_id = auth.uid());
$$;

create or replace function cfg(p_chave text)
returns text
language sql stable security definer set search_path = public
as $$
  select valor from configuracoes where chave = p_chave;
$$;

create or replace function hoje_sp()
returns date
language sql stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- ---------------------------------------------------------------------
-- Cadastro do solicitante: criado junto com o usuário do login
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into solicitantes (id, nome, telefone, email, grupo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(new.raw_user_meta_data->>'telefone', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data->>'grupo', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Pendências sem resposta no prazo expiram e liberam o turno
-- ---------------------------------------------------------------------
create function expirar_pendentes()
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update reservas
     set status = 'expirada'
   where status = 'pendente'
     and criado_em < now() - make_interval(hours => cfg('prazo_aprovacao_horas')::int);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Criar reserva (um ou mais turnos do mesmo dia e da mesma sala).
-- Nome, telefone e grupo são informados a cada reserva.
-- Secretaria: reserva confirmada direto e sem antecedência mínima.
-- Retorna o código do comprovante.
-- ---------------------------------------------------------------------
create function criar_reserva(
  p_sala_id   bigint,
  p_data      date,
  p_turnos    text[],
  p_nome      text,
  p_telefone  text,
  p_grupo     text,
  p_motivo    text,
  p_tipo      text default 'paroquiano',   -- 'paroquiano' ou 'externo' (outra paróquia)
  p_endereco  text default null,
  p_paroquia  text default null,
  p_paroco    text default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean := is_admin();
  v_sala    salas%rowtype;
  v_turno   turnos%rowtype;
  v_cod     text;
  v_status  text;
  v_inicio  timestamptz;
  v_hoje    date := hoje_sp();
  v_codigo  text;
  v_nome    text := trim(coalesce(p_nome, ''));
  v_fone    text := trim(coalesce(p_telefone, ''));
  v_grupo   text := regexp_replace(trim(coalesce(p_grupo, '')), '\s+', ' ', 'g');
  v_tipo    text := case when p_tipo = 'externo' then 'externo' else 'paroquiano' end;
  v_end     text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq   text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco  text := nullif(trim(coalesce(p_paroco, '')), '');
begin
  if v_uid is null then
    raise exception 'Entre com seu e-mail e senha para reservar.';
  end if;
  if v_nome = '' then
    raise exception 'Informe seu nome.';
  end if;
  if length(regexp_replace(v_fone, '\D', '', 'g')) < 10 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  if v_grupo = '' then
    raise exception 'Informe a pastoral ou o grupo.';
  end if;
  if p_turnos is null or array_length(p_turnos, 1) is null then
    raise exception 'Escolha pelo menos um turno.';
  end if;
  if v_tipo = 'externo' then
    if v_end is null then raise exception 'Informe o endereço.'; end if;
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
  end if;

  select * into v_sala from salas where id = p_sala_id;
  if not found or not v_sala.ativa then
    raise exception 'Sala indisponível para reservas.';
  end if;

  if not v_admin and p_data > v_hoje + cfg('janela_dias')::int then
    raise exception 'A agenda está aberta só para os próximos % dias.', cfg('janela_dias');
  end if;

  perform expirar_pendentes();

  -- Guarda os dados usados, para preencher o formulário da próxima vez
  insert into solicitantes (id, nome, telefone, email, grupo)
  values (v_uid, v_nome, v_fone, coalesce((select email from auth.users where id = v_uid), ''), v_grupo)
  on conflict (id) do update set nome = excluded.nome, telefone = excluded.telefone, grupo = excluded.grupo;

  -- Pendente: sala controlada (palestra) ou pedido de outra paróquia. A secretaria confirma direto.
  v_status := case when (v_sala.controlada or v_tipo = 'externo') and not v_admin then 'pendente' else 'confirmada' end;

  foreach v_cod in array p_turnos loop
    select * into v_turno from turnos where codigo = v_cod;
    if not found then
      raise exception 'Turno % inválido.', v_cod;
    end if;
    if not (extract(dow from p_data)::int = any (v_turno.dias_semana)) then
      raise exception 'O turno % não funciona neste dia.', v_turno.nome;
    end if;

    v_inicio := (p_data + v_turno.inicio) at time zone 'America/Sao_Paulo';
    if v_admin then
      if v_inicio < now() then
        raise exception 'O turno % já começou.', v_turno.nome;
      end if;
    elsif v_inicio < now() + make_interval(hours => cfg('antecedencia_min_horas')::int) then
      raise exception 'A reserva do turno % precisa de % horas de antecedência.', v_turno.nome, cfg('antecedencia_min_horas');
    end if;

    if exists (
      select 1 from bloqueios b
       where b.sala_id = p_sala_id
         and p_data between b.data_inicio and b.data_fim
         and (b.turnos is null or cardinality(b.turnos) = 0 or v_cod = any (b.turnos))
    ) then
      raise exception 'A sala está bloqueada no turno %.', v_turno.nome;
    end if;

    -- o código só é gerado depois das verificações, para não pular números
    if v_codigo is null then
      v_codigo := 'SJ-' || to_char(v_hoje, 'YYYY') || '-' || lpad(nextval('reserva_seq')::text, 4, '0');
    end if;

    begin
      insert into reservas (codigo, sala_id, grupo, responsavel_nome, responsavel_telefone, solicitante_id,
                            data, turno_id, motivo, status, aprovado_por, aprovado_em,
                            tipo, endereco, paroquia_origem, paroco_responsavel)
      values (v_codigo, p_sala_id, v_grupo, v_nome, v_fone, v_uid, p_data, v_turno.id,
              nullif(trim(p_motivo), ''), v_status,
              case when v_admin and (v_sala.controlada or v_tipo = 'externo') then v_uid end,
              case when v_admin and (v_sala.controlada or v_tipo = 'externo') then now() end,
              v_tipo,
              case when v_tipo = 'externo' then v_end end,
              case when v_tipo = 'externo' then v_paroq end,
              case when v_tipo = 'externo' then v_paroco end);
    exception when unique_violation then
      raise exception 'O turno % acabou de ser reservado por outro grupo.', v_turno.nome;
    end;
  end loop;

  return v_codigo;
end;
$$;

-- ---------------------------------------------------------------------
-- Comprovante público pelo código (link único).
-- Mostra os dados ATUAIS; o responsável aparece só com o primeiro nome
-- e a inicial do último sobrenome (LGPD).
-- ---------------------------------------------------------------------
create function obter_comprovante(p_codigo text)
returns table (
  codigo        text,
  sala          text,
  capacidade    int,
  controlada    boolean,
  data          date,
  turno         text,
  turno_codigo  text,
  inicio        time,
  fim           time,
  grupo         text,
  responsavel   text,
  motivo        text,
  status        text,
  motivo_recusa text,
  regras        text,
  tipo          text,
  paroquia_origem text,
  itens         jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.codigo,
         coalesce(s.nome, 'Sala ' || s.numero),
         s.capacidade,
         s.controlada,
         r.data,
         t.nome,
         t.codigo,
         t.inicio,
         t.fim,
         r.grupo,
         split_part(trim(r.responsavel_nome), ' ', 1) ||
           case when position(' ' in trim(r.responsavel_nome)) > 0
                then ' ' || left((string_to_array(trim(r.responsavel_nome), ' '))[array_length(string_to_array(trim(r.responsavel_nome), ' '), 1)], 1) || '.'
                else '' end,
         r.motivo,
         r.status,
         r.motivo_recusa,
         cfg('texto_regras'),
         r.tipo,
         r.paroquia_origem,
         s.itens
    from reservas r
    join salas s   on s.id = r.sala_id
    join turnos t  on t.id = r.turno_id
   where r.codigo = upper(trim(p_codigo))
   order by t.ordem;
$$;

-- ---------------------------------------------------------------------
-- Nomes de grupos já usados (sugestões ao digitar)
-- ---------------------------------------------------------------------
create function grupos_usados()
returns setof text
language sql stable security definer set search_path = public
as $$
  select g from (
    select distinct grupo as g from reservas where coalesce(trim(grupo), '') <> ''
  ) x
  order by g
  limit 300;
$$;

-- ---------------------------------------------------------------------
-- Aprovar ou recusar um pedido pendente (somente secretaria)
-- ---------------------------------------------------------------------
create function decidir_reserva(p_codigo text, p_aprovar boolean, p_motivo text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode aprovar ou recusar.';
  end if;
  if not p_aprovar and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da recusa.';
  end if;

  update reservas
     set status        = case when p_aprovar then 'confirmada' else 'recusada' end,
         aprovado_por  = auth.uid(),
         aprovado_em   = now(),
         motivo_recusa = case when p_aprovar then null else trim(p_motivo) end
   where codigo = p_codigo
     and status = 'pendente';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Pedido não está mais pendente.';
  end if;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Excluir coordenador (somente secretaria). Apaga o login e o cadastro;
-- as reservas ficam guardadas, sem ligação com a conta.
create or replace function excluir_coordenador(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode excluir cadastros.';
  end if;
  if p_id = auth.uid() then
    raise exception 'Você não pode excluir a própria conta.';
  end if;
  if exists (select 1 from administradores where user_id = p_id) then
    raise exception 'Esta conta é da secretaria. Retire o acesso de secretaria antes de excluir.';
  end if;
  delete from auth.users where id = p_id;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Secretaria define nova senha de um coordenador
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create or replace function definir_senha(p_id uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode definir senhas.';
  end if;
  if p_id = auth.uid() then
    raise exception 'Para trocar a sua própria senha, use "Alterar minha senha" no site.';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_senha, gen_salt('bf')),
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end;
$$;

revoke execute on function criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function definir_senha(uuid, text) from public, anon;
revoke execute on function excluir_coordenador(uuid) from public, anon;
revoke execute on function decidir_reserva(text, boolean, text) from public, anon;
revoke execute on function handle_new_user() from public, anon, authenticated;

grant execute on function is_admin()              to anon, authenticated;
grant execute on function expirar_pendentes()     to anon, authenticated;
grant execute on function obter_comprovante(text) to anon, authenticated;
grant execute on function grupos_usados()         to anon, authenticated;
grant execute on function criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text) to authenticated;
grant execute on function decidir_reserva(text, boolean, text) to authenticated;
grant execute on function excluir_coordenador(uuid) to authenticated;
grant execute on function definir_senha(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> policies.sql

-- =====================================================================
-- policies.sql — regras de acesso (Row Level Security)
-- Execute por último.
--   Público (sem login): lê salas, turnos, bloqueios e a agenda.
--   Solicitante: lê e atualiza o próprio cadastro; lê as próprias reservas.
--                Reserva somente pela função criar_reserva().
--   Secretaria: lê e altera tudo.
-- =====================================================================

alter table configuracoes   enable row level security;
alter table salas           enable row level security;
alter table administradores enable row level security;
alter table solicitantes    enable row level security;
alter table turnos          enable row level security;
alter table recorrencias    enable row level security;
alter table reservas        enable row level security;
alter table bloqueios       enable row level security;

-- Configurações
drop policy if exists cfg_ler on configuracoes;
create policy cfg_ler on configuracoes for select using (true);
drop policy if exists cfg_admin on configuracoes;
create policy cfg_admin on configuracoes for all using (is_admin()) with check (is_admin());

-- Salas
drop policy if exists salas_ler on salas;
create policy salas_ler on salas for select using (ativa or is_admin());
drop policy if exists salas_admin on salas;
create policy salas_admin on salas for all using (is_admin()) with check (is_admin());

-- Administradores: cada um vê a própria linha; inclusão só pelo SQL Editor
drop policy if exists adm_ler on administradores;
create policy adm_ler on administradores for select using (user_id = auth.uid());

-- Solicitantes
drop policy if exists solic_ler on solicitantes;
create policy solic_ler on solicitantes for select using (id = auth.uid() or is_admin());
drop policy if exists solic_inserir on solicitantes;
create policy solic_inserir on solicitantes for insert with check (id = auth.uid());
drop policy if exists solic_alterar on solicitantes;
create policy solic_alterar on solicitantes for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists solic_admin on solicitantes;
create policy solic_admin on solicitantes for all using (is_admin()) with check (is_admin());

-- Turnos
drop policy if exists turnos_ler on turnos;
create policy turnos_ler on turnos for select using (true);
drop policy if exists turnos_admin on turnos;
create policy turnos_admin on turnos for all using (is_admin()) with check (is_admin());

-- Recorrências
drop policy if exists rec_admin on recorrencias;
create policy rec_admin on recorrencias for all using (is_admin()) with check (is_admin());

-- Reservas: sem insert direto (só pela função criar_reserva)
drop policy if exists res_ler on reservas;
create policy res_ler on reservas for select using (solicitante_id = auth.uid() or is_admin());
drop policy if exists res_admin on reservas;
create policy res_admin on reservas for all using (is_admin()) with check (is_admin());

-- Bloqueios
drop policy if exists bloq_ler on bloqueios;
create policy bloq_ler on bloqueios for select using (true);
drop policy if exists bloq_admin on bloqueios;
create policy bloq_admin on bloqueios for all using (is_admin()) with check (is_admin());

-- Agenda pública (view sem dados pessoais)
grant select on agenda_publica to anon, authenticated;

-- Acesso às tabelas (as regras acima decidem quais linhas cada um vê)
grant select on configuracoes, salas, turnos, bloqueios to anon, authenticated;
grant select, insert, update on solicitantes to authenticated;
grant select, insert, update, delete on configuracoes, salas, turnos, bloqueios, reservas, recorrencias to authenticated;
grant select on administradores to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atendimentos.sql

-- =====================================================================
-- atendimentos.sql — Direcionamento Espiritual (agenda do Pároco)
-- Gerida pela secretaria e pelo Pároco. Pelo site, qualquer pessoa com
-- conta pode PEDIR um horário; o pedido fica aguardando confirmação.
-- Instalação nova: rode depois de policies.sql.
-- Banco em uso: rode depois de atualizacao-paroquia.sql e functions.sql.
-- Pode ser executado de novo sem problema. Não apaga dados.
--
-- Para dar acesso ao Pároco (depois de criar a conta em Authentication > Users):
--   insert into parocos (user_id) select id from auth.users where email = 'paroco@exemplo.com';
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pároco(s)
-- ---------------------------------------------------------------------
create table if not exists parocos (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create or replace function is_paroco()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from parocos where user_id = auth.uid());
$$;

-- Secretaria ou Pároco
create or replace function pode_atender()
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_admin() or is_paroco();
$$;

-- ---------------------------------------------------------------------
-- Horários de atendimento (grade semanal). dia_semana: 0 = domingo ... 6 = sábado
-- publico: 'paroquianos' (paroquianos e, com liberação, outras paróquias) ou 'enfermos'
-- ---------------------------------------------------------------------
create table if not exists atend_horarios (
  id           bigint generated always as identity primary key,
  dia_semana   int  not null check (dia_semana between 0 and 6),
  inicio       time not null,
  fim          time not null,
  duracao_min  int  not null default 30 check (duracao_min between 10 and 240),
  publico      text not null default 'paroquianos' check (publico in ('paroquianos','enfermos')),
  ativo        boolean not null default true,
  check (fim > inicio)
);

insert into atend_horarios (dia_semana, inicio, fim, duracao_min, publico)
select * from (values (2, '16:00'::time, '18:00'::time, 30, 'paroquianos'),
                      (4, '09:00'::time, '11:30'::time, 30, 'enfermos')) v
where not exists (select 1 from atend_horarios);

-- ---------------------------------------------------------------------
-- Atendimentos agendados
-- tipo: paroquiano | externo (outra paróquia, precisa liberação da secretaria) | enfermo
-- status: agendado | pendente (outra paróquia, aguarda a secretaria)
--         | solicitado (pedido pelo site, aguarda a secretaria ou o Pároco) | realizado | cancelado
-- ---------------------------------------------------------------------
create table if not exists atendimentos (
  id                  bigint generated always as identity primary key,
  data                date not null,
  inicio              time not null,
  fim                 time not null,
  nome                text not null,
  telefone            text not null,
  tipo                text not null check (tipo in ('paroquiano','externo','enfermo')),
  assunto             text,
  endereco            text,
  paroquia_origem     text,
  paroco_responsavel  text,
  status              text not null default 'agendado' check (status in ('agendado','pendente','solicitado','realizado','cancelado')),
  criado_por          uuid references auth.users(id) on delete set null,
  liberado_por        uuid references auth.users(id) on delete set null,
  liberado_em         timestamptz,
  criado_em           timestamptz not null default now(),
  check (fim > inicio)
);

-- Local onde o enfermo se encontra (casa, hospital...), obrigatório para enfermos
alter table atendimentos add column if not exists local_atendimento text;

-- Um horário só tem um atendimento ativo
-- (banco já existente: aceita o novo status 'solicitado')
alter table atendimentos drop constraint if exists atendimentos_status_check;
alter table atendimentos add constraint atendimentos_status_check
  check (status in ('agendado','pendente','solicitado','realizado','cancelado'));

drop index if exists atendimentos_horario_unico;
create unique index atendimentos_horario_unico
  on atendimentos (data, inicio)
  where status in ('agendado','pendente','solicitado','realizado');

-- ---------------------------------------------------------------------
-- Bloqueios da agenda. inicio/fim vazios = dia todo
-- ---------------------------------------------------------------------
create table if not exists atend_bloqueios (
  id           bigint generated always as identity primary key,
  data_inicio  date not null,
  data_fim     date not null check (data_fim >= data_inicio),
  inicio       time,
  fim          time,
  motivo       text not null,
  criado_por   uuid references auth.users(id) on delete set null,
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Agendar (secretaria ou Pároco)
-- ---------------------------------------------------------------------
drop function if exists agendar_atendimento(date, time, time, text, text, text, text, text, text, text);
drop function if exists agendar_atendimento(date, time, time, text, text, text, text, text, text, text, text);
create function agendar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq  text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco text := nullif(trim(coalesce(p_paroco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_status text;
  v_id     bigint;
begin
  if not pode_atender() then
    raise exception 'Somente a secretaria e o Pároco podem agendar.';
  end if;
  if p_tipo not in ('paroquiano','externo','enfermo') then
    raise exception 'Tipo de atendimento inválido.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(regexp_replace(v_fone, '\D', '', 'g')) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if p_tipo = 'externo' then
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
    if v_end is null then raise exception 'Informe o endereço.'; end if;
  end if;
  if p_tipo = 'enfermo' and v_end is null then
    raise exception 'Informe o endereço do enfermo.';
  end if;
  if p_tipo = 'enfermo' and v_local is null then
    raise exception 'Informe o local onde o enfermo se encontra.';
  end if;

  -- O horário precisa estar na grade, e o público precisa combinar
  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário está bloqueado.';
  end if;

  -- Outra paróquia: fica pendente até a secretaria liberar
  v_status := case when p_tipo = 'externo' and not is_admin() then 'pendente' else 'agendado' end;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento, paroquia_origem,
                              paroco_responsavel, status, criado_por, liberado_por, liberado_em)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            case when p_tipo = 'externo' then v_paroq end,
            case when p_tipo = 'externo' then v_paroco end,
            v_status, auth.uid(),
            case when p_tipo = 'externo' and is_admin() then auth.uid() end,
            case when p_tipo = 'externo' and is_admin() then now() end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado.';
  end;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Liberar pedido de outra paróquia (somente secretaria)
-- ---------------------------------------------------------------------
create or replace function liberar_atendimento(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode liberar atendimentos de outras paróquias.';
  end if;
  update atendimentos
     set status = 'agendado', liberado_por = auth.uid(), liberado_em = now()
   where id = p_id and status = 'pendente';
  if not found then
    raise exception 'Este atendimento não está aguardando liberação.';
  end if;
end;
$$;

-- O Pároco não pode liberar por conta própria um pedido pendente
create or replace function atend_protege_pendente()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status = 'pendente' and new.status in ('agendado','realizado') and not is_admin() then
    raise exception 'Pedidos de outras paróquias precisam ser liberados pela secretaria.';
  end if;
  return new;
end;
$$;

drop trigger if exists atend_protege_pendente on atendimentos;
create trigger atend_protege_pendente
  before update on atendimentos
  for each row execute function atend_protege_pendente();

-- ---------------------------------------------------------------------
-- Regras de acesso: só secretaria e Pároco
-- ---------------------------------------------------------------------
alter table parocos         enable row level security;
alter table atend_horarios  enable row level security;
alter table atendimentos    enable row level security;
alter table atend_bloqueios enable row level security;

drop policy if exists paroco_ler on parocos;
create policy paroco_ler on parocos for select using (user_id = auth.uid() or is_admin());

drop policy if exists atend_hor_gestao on atend_horarios;
create policy atend_hor_gestao on atend_horarios for all using (pode_atender()) with check (pode_atender());

drop policy if exists atend_gestao on atendimentos;
create policy atend_gestao on atendimentos for all using (pode_atender()) with check (pode_atender());

drop policy if exists atend_bloq_gestao on atend_bloqueios;
create policy atend_bloq_gestao on atend_bloqueios for all using (pode_atender()) with check (pode_atender());

grant select on parocos to authenticated;
grant select, insert, update, delete on atend_horarios, atendimentos, atend_bloqueios to authenticated;

revoke execute on function agendar_atendimento(date, time, time, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function liberar_atendimento(bigint) from public, anon;
grant execute on function is_paroco()    to anon, authenticated;
grant execute on function pode_atender() to anon, authenticated;
grant execute on function agendar_atendimento(date, time, time, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function liberar_atendimento(bigint) to authenticated;


-- =====================================================================
-- Pedidos pelo site (caixa "Direcionamento Espiritual")
-- =====================================================================

-- Agenda pública: só horários, ocupados e bloqueios. Sem nomes nem assuntos (LGPD).
create or replace function atend_agenda_publica(p_de date, p_ate date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'horarios', coalesce((select jsonb_agg(jsonb_build_object(
        'dia_semana', h.dia_semana, 'inicio', h.inicio, 'fim', h.fim,
        'duracao_min', h.duracao_min, 'publico', h.publico) order by h.dia_semana, h.inicio)
      from atend_horarios h where h.ativo), '[]'::jsonb),
    'ocupados', coalesce((select jsonb_agg(jsonb_build_object('data', a.data, 'inicio', a.inicio, 'fim', a.fim))
      from atendimentos a
      where a.data between p_de and least(p_ate, p_de + 62)
        and a.status in ('agendado','pendente','solicitado','realizado')), '[]'::jsonb),
    'bloqueios', coalesce((select jsonb_agg(jsonb_build_object(
        'data_inicio', b.data_inicio, 'data_fim', b.data_fim, 'inicio', b.inicio, 'fim', b.fim))
      from atend_bloqueios b
      where b.data_fim >= p_de and b.data_inicio <= least(p_ate, p_de + 62)), '[]'::jsonb)
  );
$$;

-- Área de atendimento da paróquia: endereços que começam com QND ou QNE
-- (aceita "qnd 20", "QND20", "Q.N.D. 20", "QNE-12"...)
create or replace function endereco_na_area(p_endereco text)
returns boolean
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_endereco, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(QND|QNE)';
$$;

-- Pedido feito pela própria pessoa (precisa estar logada)
drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text);
drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text);
create function solicitar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq  text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco text := nullif(trim(coalesce(p_paroco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_id     bigint;
begin
  if auth.uid() is null then
    raise exception 'Entre com sua conta para pedir um horário.';
  end if;
  if p_tipo = 'externo' then
    raise exception 'O Direcionamento Espiritual é exclusivo para paroquianos. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo not in ('paroquiano','enfermo') then
    raise exception 'Escolha para quem é o atendimento.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(regexp_replace(v_fone, '\D', '', 'g')) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if v_end is null then raise exception 'Informe o endereço.'; end if;
  if p_tipo = 'enfermo' and v_local is null then raise exception 'Informe o local onde o enfermo se encontra.'; end if;
  if not endereco_na_area(v_end) then
    raise exception 'Este endereço não pertence à área de atendimento da Paróquia São José (QND e QNE). Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo = 'externo' then
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
  end if;

  if (p_data + p_inicio) <= v_agora then
    raise exception 'Este horário já passou.';
  end if;
  if p_data > v_agora::date + 30 then
    raise exception 'Os pedidos ficam abertos para os próximos 30 dias.';
  end if;

  -- No máximo 2 pedidos em aberto por pessoa
  if (select count(*) from atendimentos
       where criado_por = auth.uid() and data >= v_agora::date
         and status in ('agendado','pendente','solicitado')) >= 2 then
    raise exception 'Você já tem 2 atendimentos marcados ou aguardando. Fale com a secretaria se precisar de outro.';
  end if;

  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário não está disponível.';
  end if;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento,
                              paroquia_origem, paroco_responsavel, status, criado_por)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            case when p_tipo = 'externo' then v_paroq end,
            case when p_tipo = 'externo' then v_paroco end,
            case when p_tipo = 'externo' then 'pendente' else 'solicitado' end,
            auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.';
  end;
  return v_id;
end;
$$;

-- Os pedidos da própria pessoa
create or replace function meus_atendimentos()
returns table (id bigint, data date, inicio time, fim time, tipo text, status text)
language sql stable security definer set search_path = public
as $$
  select a.id, a.data, a.inicio, a.fim, a.tipo, a.status
    from atendimentos a
   where a.criado_por = auth.uid()
     and a.data >= (now() at time zone 'America/Sao_Paulo')::date - 30
   order by a.data desc, a.inicio desc
   limit 20;
$$;

-- A pessoa pode desistir do próprio pedido antes do horário
create or replace function cancelar_meu_atendimento(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update atendimentos
     set status = 'cancelado'
   where id = p_id and criado_por = auth.uid()
     and status in ('agendado','pendente','solicitado')
     and (data + inicio) > (now() at time zone 'America/Sao_Paulo');
  if not found then
    raise exception 'Este pedido não pode mais ser cancelado.';
  end if;
end;
$$;

revoke execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function meus_atendimentos() from public, anon;
revoke execute on function cancelar_meu_atendimento(bigint) from public, anon;
grant execute on function atend_agenda_publica(date, date) to anon, authenticated;
grant execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function meus_atendimentos() to authenticated;
grant execute on function cancelar_meu_atendimento(bigint) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-gestao.sql

-- =====================================================================
-- atualizacao-gestao.sql — atualiza o banco JÁ INSTALADO para a versão
-- com página de Gestão e grupo em texto livre.
-- Não apaga salas, turnos, configurações nem reservas.
-- Ordem: 1) este arquivo   2) functions.sql   3) policies.sql
-- Pode ser executado mais de uma vez sem problema.
-- =====================================================================

-- A view depende das colunas antigas: sai agora e volta no fim
drop view if exists agenda_publica;

-- ---------------------------------------------------------------------
-- Reservas: grupo em texto e nome/telefone do responsável em cada reserva
-- ---------------------------------------------------------------------
alter table reservas add column if not exists grupo text;
alter table reservas add column if not exists responsavel_nome text;
alter table reservas add column if not exists responsavel_telefone text;

alter table solicitantes add column if not exists grupo text;
alter table recorrencias add column if not exists grupo text;

-- Copia os dados da estrutura antiga (só se ela ainda existir)
do $$
begin
  if to_regclass('public.grupos') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservas' and column_name = 'grupo_id') then
      update reservas r
         set grupo = coalesce((select g.nome from grupos g where g.id = r.grupo_id), r.grupo_outro)
       where r.grupo is null;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitantes' and column_name = 'grupo_id') then
      update solicitantes s
         set grupo = coalesce((select g.nome from grupos g where g.id = s.grupo_id), s.grupo_outro)
       where s.grupo is null;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recorrencias' and column_name = 'grupo_id') then
      update recorrencias r
         set grupo = (select g.nome from grupos g where g.id = r.grupo_id)
       where r.grupo is null;
    end if;
  end if;
end $$;

update reservas r
   set responsavel_nome = coalesce(nullif(r.responsavel_nome, ''), s.nome, ''),
       responsavel_telefone = coalesce(nullif(r.responsavel_telefone, ''), s.telefone, '')
  from solicitantes s
 where s.id = r.solicitante_id
   and (r.responsavel_nome is null or r.responsavel_telefone is null);

update reservas set grupo = '' where grupo is null;
update reservas set responsavel_nome = '' where responsavel_nome is null;
update reservas set responsavel_telefone = '' where responsavel_telefone is null;

alter table reservas alter column grupo set not null;
alter table reservas alter column responsavel_nome set not null;
alter table reservas alter column responsavel_telefone set not null;

-- Colunas e tabela que deixaram de existir
alter table reservas     drop column if exists grupo_id;
alter table reservas     drop column if exists grupo_outro;
alter table solicitantes drop column if exists grupo_id;
alter table solicitantes drop column if exists grupo_outro;
alter table solicitantes drop column if exists canal_preferido;
alter table recorrencias drop column if exists grupo_id;
drop table if exists grupos cascade;

-- Nome e telefone passam a ser informados na reserva
alter table solicitantes alter column nome set default '';
alter table solicitantes alter column telefone set default '';

-- Garante que os próximos códigos de reserva não repitam os já existentes
do $$
declare v_max int;
begin
  select coalesce(max(nullif(regexp_replace(codigo, '^.*-', ''), '')::int), 0) into v_max
    from reservas where codigo ~ '^SJ-[0-9]{4}-[0-9]+$';
  if v_max > 0 then
    perform setval('reserva_seq', greatest(v_max, (select last_value from reserva_seq)));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Agenda pública (sem dados pessoais)
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-paroquia.sql

-- =====================================================================
-- atualizacao-paroquia.sql — reservas de paroquianos e de outras paróquias
-- Rode no SQL Editor, nesta ordem:
--   1) este arquivo   2) functions.sql   3) atendimentos.sql
-- Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

alter table reservas add column if not exists tipo text not null default 'paroquiano';
alter table reservas add column if not exists endereco text;
alter table reservas add column if not exists paroquia_origem text;
alter table reservas add column if not exists paroco_responsavel text;

alter table reservas drop constraint if exists reservas_tipo_check;
alter table reservas add constraint reservas_tipo_check check (tipo in ('paroquiano','externo'));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-senha.sql

-- =====================================================================
-- atualizacao-senha.sql — a secretaria define uma nova senha para um
-- coordenador pela página de Gestão. Rode uma vez no SQL Editor.
-- Pode ser executado de novo sem problema.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create or replace function definir_senha(p_id uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode definir senhas.';
  end if;
  if p_id = auth.uid() then
    raise exception 'Para trocar a sua própria senha, use "Alterar minha senha" no site.';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_senha, gen_salt('bf')),
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end;
$$;

revoke execute on function definir_senha(uuid, text) from public, anon;
grant execute on function definir_senha(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-exclusao.sql

-- =====================================================================
-- atualizacao-exclusao.sql — permite à secretaria excluir reservas e
-- coordenadores pela página de Gestão. Rode uma vez no SQL Editor.
-- Pode ser executado de novo sem problema.
-- =====================================================================

-- Reservas continuam no histórico quando o coordenador é excluído
alter table reservas alter column solicitante_id drop not null;
alter table reservas drop constraint if exists reservas_solicitante_id_fkey;
alter table reservas add constraint reservas_solicitante_id_fkey
  foreign key (solicitante_id) references solicitantes(id) on delete set null;

-- Excluir coordenador (somente secretaria). Apaga o login e o cadastro;
-- as reservas ficam guardadas, sem ligação com a conta.
create or replace function excluir_coordenador(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode excluir cadastros.';
  end if;
  if p_id = auth.uid() then
    raise exception 'Você não pode excluir a própria conta.';
  end if;
  if exists (select 1 from administradores where user_id = p_id) then
    raise exception 'Esta conta é da secretaria. Retire o acesso de secretaria antes de excluir.';
  end if;
  delete from auth.users where id = p_id;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end;
$$;

revoke execute on function excluir_coordenador(uuid) from public, anon;
grant execute on function excluir_coordenador(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-salas.sql

-- =====================================================================
-- atualizacao-salas.sql
--   1) Libera o turno da Noite às sextas-feiras.
--   2) Permite à secretaria EXCLUIR uma sala.
--      A sala sai do site e da gestão, mas as reservas antigas continuam
--      no histórico (com o nome da sala). As reservas futuras dela são
--      canceladas, e a secretaria recebe a lista para avisar pelo WhatsApp.
-- Rode no SQL Editor. Pode ser executado de novo sem problema.
-- =====================================================================

-- 1) Noite também às sextas (0 = domingo ... 6 = sábado)
update turnos set dias_semana = '{0,1,2,3,4,5,6}' where codigo = 'N';

-- 2) Exclusão de sala
alter table salas add column if not exists excluida_em timestamptz;

-- O número só precisa ser único entre as salas não excluídas
-- (assim dá para cadastrar de novo uma sala com o número de uma excluída)
alter table salas drop constraint if exists salas_numero_key;
create unique index if not exists salas_numero_unico on salas (numero) where excluida_em is null;

drop function if exists excluir_sala(bigint);
create function excluir_sala(p_id bigint)
returns table (codigo text, data date, turno text, grupo text, responsavel_nome text, responsavel_telefone text)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode excluir salas.';
  end if;
  if not exists (select 1 from salas s where s.id = p_id and s.excluida_em is null) then
    raise exception 'Sala não encontrada.';
  end if;

  update salas set excluida_em = now(), ativa = false where id = p_id;

  return query
  with canceladas as (
    update reservas r
       set status = 'cancelada'
     where r.sala_id = p_id
       and r.data >= (now() at time zone 'America/Sao_Paulo')::date
       and r.status in ('pendente','confirmada')
    returning r.codigo, r.data, r.turno_id, r.grupo, r.responsavel_nome, r.responsavel_telefone
  )
  select c.codigo, c.data, t.nome, c.grupo, c.responsavel_nome, c.responsavel_telefone
    from canceladas c join turnos t on t.id = c.turno_id
   order by c.data, t.ordem;
end;
$$;

revoke execute on function excluir_sala(bigint) from public, anon;
grant execute on function excluir_sala(bigint) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-minhas.sql

-- =====================================================================
-- atualizacao-minhas.sql — a própria pessoa CANCELA ou ALTERA sua reserva
-- (em "Minhas reservas", até o início do turno).
-- Rode no SQL Editor depois de functions.sql. Pode ser executado de novo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cancelar a própria reserva (todos os turnos ainda não iniciados do pedido)
-- ---------------------------------------------------------------------
drop function if exists cancelar_minha_reserva(text);
create function cancelar_minha_reserva(p_codigo text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_qtd int;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  if not exists (select 1 from reservas where codigo = v_cod and (solicitante_id = auth.uid() or is_admin())) then
    raise exception 'Reserva não encontrada.';
  end if;

  update reservas r
     set status = 'cancelada'
    from turnos t
   where t.id = r.turno_id
     and r.codigo = v_cod
     and (r.solicitante_id = auth.uid() or is_admin())
     and r.status in ('pendente','confirmada')
     and ((r.data + t.inicio) at time zone 'America/Sao_Paulo') > now();
  get diagnostics v_qtd = row_count;

  if v_qtd = 0 then
    raise exception 'Esta reserva não pode mais ser cancelada (já começou, já passou ou já foi cancelada).';
  end if;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------
-- Alterar a própria reserva: escolhe outro dia e turnos da MESMA sala.
-- Tudo acontece junto: a reserva antiga é cancelada e a nova é criada com
-- as mesmas regras de sempre (criar_reserva). Se a nova não puder ser
-- criada, nada muda. Retorna o código da nova reserva.
-- ---------------------------------------------------------------------
drop function if exists alterar_minha_reserva(text, date, text[]);
create function alterar_minha_reserva(p_codigo text, p_data date, p_turnos text[])
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_cod  text := upper(trim(coalesce(p_codigo, '')));
  v_old  reservas%rowtype;
  v_novo text;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;

  select * into v_old
    from reservas
   where codigo = v_cod and solicitante_id = auth.uid()
     and status in ('pendente','confirmada')
   order by data, turno_id
   limit 1;
  if not found then
    raise exception 'Esta reserva não pode ser alterada (não está ativa).';
  end if;

  if exists (
    select 1 from reservas r join turnos t on t.id = r.turno_id
     where r.codigo = v_cod and r.status in ('pendente','confirmada')
       and ((r.data + t.inicio) at time zone 'America/Sao_Paulo') <= now()
  ) then
    raise exception 'A reserva já começou e não pode mais ser alterada.';
  end if;

  -- Libera os turnos antigos (assim é possível manter algum deles na nova escolha)
  update reservas set status = 'cancelada'
   where codigo = v_cod and status in ('pendente','confirmada');

  v_novo := criar_reserva(v_old.sala_id, p_data, p_turnos,
                          v_old.responsavel_nome, v_old.responsavel_telefone, v_old.grupo, v_old.motivo,
                          v_old.tipo, v_old.endereco, v_old.paroquia_origem, v_old.paroco_responsavel);
  return v_novo;
end;
$$;

revoke execute on function cancelar_minha_reserva(text) from public, anon;
revoke execute on function alterar_minha_reserva(text, date, text[]) from public, anon;
grant execute on function cancelar_minha_reserva(text) to authenticated;
grant execute on function alterar_minha_reserva(text, date, text[]) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-itens.sql

-- =====================================================================
-- atualizacao-itens.sql — itens de cada sala (cadeiras, mesas, ventiladores...)
-- A secretaria cadastra os itens na aba Salas; eles aparecem no comprovante.
-- Rode no SQL Editor. Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

alter table salas add column if not exists itens jsonb not null default '[]';

-- Comprovante passa a trazer os itens da sala
drop function if exists obter_comprovante(text);
create function obter_comprovante(p_codigo text)
returns table (
  codigo        text,
  sala          text,
  capacidade    int,
  controlada    boolean,
  data          date,
  turno         text,
  turno_codigo  text,
  inicio        time,
  fim           time,
  grupo         text,
  responsavel   text,
  motivo        text,
  status        text,
  motivo_recusa text,
  regras        text,
  tipo          text,
  paroquia_origem text,
  itens         jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.codigo,
         coalesce(s.nome, 'Sala ' || s.numero),
         s.capacidade,
         s.controlada,
         r.data,
         t.nome,
         t.codigo,
         t.inicio,
         t.fim,
         r.grupo,
         split_part(trim(r.responsavel_nome), ' ', 1) ||
           case when position(' ' in trim(r.responsavel_nome)) > 0
                then ' ' || left((string_to_array(trim(r.responsavel_nome), ' '))[array_length(string_to_array(trim(r.responsavel_nome), ' '), 1)], 1) || '.'
                else '' end,
         r.motivo,
         r.status,
         r.motivo_recusa,
         cfg('texto_regras'),
         r.tipo,
         r.paroquia_origem,
         s.itens
    from reservas r
    join salas s   on s.id = r.sala_id
    join turnos t  on t.id = r.turno_id
   where r.codigo = upper(trim(p_codigo))
   order by t.ordem;
$$;

grant execute on function obter_comprovante(text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-limpar.sql

-- =====================================================================
-- atualizacao-limpar.sql — botão "Limpar canceladas e recusadas"
-- Tira essas reservas da lista "Minhas reservas" da própria pessoa.
-- Nada é apagado: a secretaria continua vendo tudo na Área de Gestão.
-- Rode no SQL Editor. Pode ser executado de novo sem problema.
-- =====================================================================

alter table reservas add column if not exists oculta_solicitante boolean not null default false;

drop function if exists limpar_minhas_reservas();
create function limpar_minhas_reservas()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_qtd int;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  update reservas
     set oculta_solicitante = true
   where solicitante_id = auth.uid()
     and status in ('cancelada','recusada')
     and not oculta_solicitante;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke execute on function limpar_minhas_reservas() from public, anon;
grant execute on function limpar_minhas_reservas() to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-minhas-atendimentos.sql

-- =====================================================================
-- atualizacao-minhas-atendimentos.sql
-- Os pedidos de Direcionamento Espiritual passam a aparecer em "Minhas reservas".
-- O botão "Limpar canceladas e recusadas" também limpa os atendimentos cancelados.
-- Rode no SQL Editor depois de atendimentos.sql e atualizacao-limpar.sql.
-- Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

alter table atendimentos add column if not exists oculto_solicitante boolean not null default false;

-- Pedidos da própria pessoa (não mostra os que a secretaria ou o Pároco marcaram para outros)
create or replace function meus_atendimentos()
returns table (id bigint, data date, inicio time, fim time, tipo text, status text)
language sql stable security definer set search_path = public
as $$
  select a.id, a.data, a.inicio, a.fim, a.tipo, a.status
    from atendimentos a
   where a.criado_por = auth.uid()
     and not a.oculto_solicitante
     and not pode_atender()
     and a.data >= (now() at time zone 'America/Sao_Paulo')::date - 30
   order by a.data desc, a.inicio desc
   limit 20;
$$;

-- "Limpar canceladas e recusadas": reservas de sala e atendimentos
create or replace function limpar_minhas_reservas()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_res int; v_at int;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  update reservas
     set oculta_solicitante = true
   where solicitante_id = auth.uid()
     and status in ('cancelada','recusada')
     and not oculta_solicitante;
  get diagnostics v_res = row_count;
  update atendimentos
     set oculto_solicitante = true
   where criado_por = auth.uid()
     and status = 'cancelado'
     and not oculto_solicitante;
  get diagnostics v_at = row_count;
  return v_res + v_at;
end;
$$;

revoke execute on function meus_atendimentos() from public, anon;
revoke execute on function limpar_minhas_reservas() from public, anon;
grant execute on function meus_atendimentos() to authenticated;
grant execute on function limpar_minhas_reservas() to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-ocultar.sql

-- =====================================================================
-- atualizacao-ocultar.sql — "Excluir" e "Limpar encerradas" em Minhas reservas
-- Tira da lista da própria pessoa as reservas e atendimentos encerrados:
-- cancelados, recusados, expirados, "não compareceu", realizados ou já passados.
-- Nada é apagado: a secretaria continua vendo tudo na Área de Gestão.
-- Rode no SQL Editor depois de atualizacao-minhas-atendimentos.sql.
-- Pode ser executado de novo sem problema.
-- =====================================================================

alter table reservas     add column if not exists oculta_solicitante boolean not null default false;
alter table atendimentos add column if not exists oculto_solicitante boolean not null default false;

-- Uma reserva (todas as linhas do mesmo código)
drop function if exists ocultar_minha_reserva(text);
create function ocultar_minha_reserva(p_codigo text)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_qtd int;
begin
  if auth.uid() is null then raise exception 'Entre com seu e-mail e senha.'; end if;
  update reservas r
     set oculta_solicitante = true
    from turnos t
   where t.id = r.turno_id
     and r.codigo = upper(trim(p_codigo))
     and r.solicitante_id = auth.uid()
     and (r.status not in ('pendente','confirmada')
          or ((r.data + t.fim) at time zone 'America/Sao_Paulo') < now());
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then
    raise exception 'Só é possível excluir reservas encerradas. Para uma reserva futura, use Cancelar.';
  end if;
  return v_qtd;
end;
$$;

-- Um atendimento de Direcionamento Espiritual
drop function if exists ocultar_meu_atendimento(bigint);
create function ocultar_meu_atendimento(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre com seu e-mail e senha.'; end if;
  update atendimentos
     set oculto_solicitante = true
   where id = p_id and criado_por = auth.uid()
     and (status in ('cancelado','realizado')
          or ((data + fim) at time zone 'America/Sao_Paulo') < now());
  if not found then
    raise exception 'Só é possível excluir atendimentos encerrados. Para um pedido futuro, use Cancelar.';
  end if;
end;
$$;

-- "Limpar encerradas": tudo de uma vez
create or replace function limpar_minhas_reservas()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_res int; v_at int;
begin
  if auth.uid() is null then raise exception 'Entre com seu e-mail e senha.'; end if;
  update reservas r
     set oculta_solicitante = true
    from turnos t
   where t.id = r.turno_id
     and r.solicitante_id = auth.uid()
     and not r.oculta_solicitante
     and (r.status not in ('pendente','confirmada')
          or ((r.data + t.fim) at time zone 'America/Sao_Paulo') < now());
  get diagnostics v_res = row_count;
  update atendimentos
     set oculto_solicitante = true
   where criado_por = auth.uid()
     and not oculto_solicitante
     and (status in ('cancelado','realizado')
          or ((data + fim) at time zone 'America/Sao_Paulo') < now());
  get diagnostics v_at = row_count;
  return v_res + v_at;
end;
$$;

revoke execute on function ocultar_minha_reserva(text) from public, anon;
revoke execute on function ocultar_meu_atendimento(bigint) from public, anon;
revoke execute on function limpar_minhas_reservas() from public, anon;
grant execute on function ocultar_minha_reserva(text) to authenticated;
grant execute on function ocultar_meu_atendimento(bigint) to authenticated;
grant execute on function limpar_minhas_reservas() to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-area.sql

-- =====================================================================
-- atualizacao-area.sql — Direcionamento Espiritual só para a área da paróquia
--   * Endereço precisa começar com QND ou QNE.
--   * Não paroquianos (outras paróquias) não pedem Direcionamento Espiritual.
--   * A secretaria e o Pároco, pela Área de Gestão, continuam podendo agendar exceções.
-- Rode no SQL Editor. Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

-- Área de atendimento da paróquia: endereços que começam com QND ou QNE
-- (aceita "qnd 20", "QND20", "Q.N.D. 20", "QNE-12"...)
create or replace function endereco_na_area(p_endereco text)
returns boolean
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_endereco, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(QND|QNE)';
$$;

-- Pedido feito pela própria pessoa (precisa estar logada)
drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text);
create function solicitar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq  text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco text := nullif(trim(coalesce(p_paroco, '')), '');
  v_pub    text;
  v_id     bigint;
begin
  if auth.uid() is null then
    raise exception 'Entre com sua conta para pedir um horário.';
  end if;
  if p_tipo = 'externo' then
    raise exception 'O Direcionamento Espiritual é exclusivo para paroquianos. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo not in ('paroquiano','enfermo') then
    raise exception 'Escolha para quem é o atendimento.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(regexp_replace(v_fone, '\D', '', 'g')) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if v_end is null then raise exception 'Informe o endereço.'; end if;
  if not endereco_na_area(v_end) then
    raise exception 'Este endereço não pertence à área de atendimento da Paróquia São José (QND e QNE). Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo = 'externo' then
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
  end if;

  if (p_data + p_inicio) <= v_agora then
    raise exception 'Este horário já passou.';
  end if;
  if p_data > v_agora::date + 30 then
    raise exception 'Os pedidos ficam abertos para os próximos 30 dias.';
  end if;

  -- No máximo 2 pedidos em aberto por pessoa
  if (select count(*) from atendimentos
       where criado_por = auth.uid() and data >= v_agora::date
         and status in ('agendado','pendente','solicitado')) >= 2 then
    raise exception 'Você já tem 2 atendimentos marcados ou aguardando. Fale com a secretaria se precisar de outro.';
  end if;

  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário não está disponível.';
  end if;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco,
                              paroquia_origem, paroco_responsavel, status, criado_por)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'externo' then v_paroq end,
            case when p_tipo = 'externo' then v_paroco end,
            case when p_tipo = 'externo' then 'pendente' else 'solicitado' end,
            auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.';
  end;
  return v_id;
end;
$$;

revoke execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text) from public, anon;
grant execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-local.sql

-- =====================================================================
-- atualizacao-local.sql — atendimento a enfermos (quintas-feiras)
-- Novo campo obrigatório: local onde o enfermo se encontra (casa, hospital...).
-- O endereço residencial continua obrigatório e precisa ser QND ou QNE nos pedidos pelo site.
-- Rode no SQL Editor depois de atualizacao-area.sql. Pode ser executado de novo. Não apaga dados.
-- =====================================================================

alter table atendimentos add column if not exists local_atendimento text;

-- Área de atendimento da paróquia: endereços que começam com QND ou QNE
-- (aceita "qnd 20", "QND20", "Q.N.D. 20", "QNE-12"...)
create or replace function endereco_na_area(p_endereco text)
returns boolean
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_endereco, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(QND|QNE)';
$$;

drop function if exists agendar_atendimento(date, time, time, text, text, text, text, text, text, text);
drop function if exists agendar_atendimento(date, time, time, text, text, text, text, text, text, text, text);
create function agendar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq  text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco text := nullif(trim(coalesce(p_paroco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_status text;
  v_id     bigint;
begin
  if not pode_atender() then
    raise exception 'Somente a secretaria e o Pároco podem agendar.';
  end if;
  if p_tipo not in ('paroquiano','externo','enfermo') then
    raise exception 'Tipo de atendimento inválido.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(regexp_replace(v_fone, '\D', '', 'g')) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if p_tipo = 'externo' then
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
    if v_end is null then raise exception 'Informe o endereço.'; end if;
  end if;
  if p_tipo = 'enfermo' and v_end is null then
    raise exception 'Informe o endereço do enfermo.';
  end if;
  if p_tipo = 'enfermo' and v_local is null then
    raise exception 'Informe o local onde o enfermo se encontra.';
  end if;

  -- O horário precisa estar na grade, e o público precisa combinar
  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário está bloqueado.';
  end if;

  -- Outra paróquia: fica pendente até a secretaria liberar
  v_status := case when p_tipo = 'externo' and not is_admin() then 'pendente' else 'agendado' end;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento, paroquia_origem,
                              paroco_responsavel, status, criado_por, liberado_por, liberado_em)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            case when p_tipo = 'externo' then v_paroq end,
            case when p_tipo = 'externo' then v_paroco end,
            v_status, auth.uid(),
            case when p_tipo = 'externo' and is_admin() then auth.uid() end,
            case when p_tipo = 'externo' and is_admin() then now() end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado.';
  end;
  return v_id;
end;
$$;

drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text);
drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text);
create function solicitar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq  text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco text := nullif(trim(coalesce(p_paroco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_id     bigint;
begin
  if auth.uid() is null then
    raise exception 'Entre com sua conta para pedir um horário.';
  end if;
  if p_tipo = 'externo' then
    raise exception 'O Direcionamento Espiritual é exclusivo para paroquianos. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo not in ('paroquiano','enfermo') then
    raise exception 'Escolha para quem é o atendimento.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(regexp_replace(v_fone, '\D', '', 'g')) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if v_end is null then raise exception 'Informe o endereço.'; end if;
  if p_tipo = 'enfermo' and v_local is null then raise exception 'Informe o local onde o enfermo se encontra.'; end if;
  if not endereco_na_area(v_end) then
    raise exception 'Este endereço não pertence à área de atendimento da Paróquia São José (QND e QNE). Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo = 'externo' then
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
  end if;

  if (p_data + p_inicio) <= v_agora then
    raise exception 'Este horário já passou.';
  end if;
  if p_data > v_agora::date + 30 then
    raise exception 'Os pedidos ficam abertos para os próximos 30 dias.';
  end if;

  -- No máximo 2 pedidos em aberto por pessoa
  if (select count(*) from atendimentos
       where criado_por = auth.uid() and data >= v_agora::date
         and status in ('agendado','pendente','solicitado')) >= 2 then
    raise exception 'Você já tem 2 atendimentos marcados ou aguardando. Fale com a secretaria se precisar de outro.';
  end if;

  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário não está disponível.';
  end if;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento,
                              paroquia_origem, paroco_responsavel, status, criado_por)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            case when p_tipo = 'externo' then v_paroq end,
            case when p_tipo = 'externo' then v_paroco end,
            case when p_tipo = 'externo' then 'pendente' else 'solicitado' end,
            auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.';
  end;
  return v_id;
end;
$$;

revoke execute on function agendar_atendimento(date, time, time, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function agendar_atendimento(date, time, time, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> pastorais.sql

-- =====================================================================
-- pastorais.sql — cadastro de Pastorais, Movimentos e Grupos
-- (aba "Pastorais e Movimentos" da Área de Gestão)
-- Rode no SQL Editor depois de functions.sql. Pode ser executado de novo:
-- os dados iniciais só entram se a tabela estiver vazia.
-- =====================================================================

create table if not exists pastorais (
  id             bigint generated always as identity primary key,
  numero         int,
  nome           text not null check (length(trim(nome)) > 0),
  coordenadores  jsonb not null default '[]'::jsonb,   -- [{nome, telefone, email}]
  reunioes       jsonb not null default '[]'::jsonb,   -- [{dia, local, horario, observacao}]
  observacao     text,
  atualizado_em  timestamptz not null default now()
);

-- Data da última alteração da lista (inclusões, alterações e exclusões)
create or replace function pastorais_alterada()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  insert into configuracoes (chave, valor, descricao)
       values ('pastorais_atualizadas_em', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'Última alteração do cadastro de pastorais')
  on conflict (chave) do update set valor = excluded.valor;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_pastorais_alterada on pastorais;
create trigger trg_pastorais_alterada
  before insert or update or delete on pastorais
  for each row execute function pastorais_alterada();

-- Somente a secretaria vê e altera (telefones e e-mails são dados pessoais)
alter table pastorais enable row level security;
drop policy if exists pastorais_admin on pastorais;
create policy pastorais_admin on pastorais for all using (is_admin()) with check (is_admin());
revoke all on pastorais from anon;
grant select, insert, update, delete on pastorais to authenticated;

-- Lista pública só com os NOMES, para o campo "Pastoral ou grupo" das reservas
drop function if exists nomes_pastorais();
create function nomes_pastorais()
returns setof text
language sql stable security definer set search_path = public
as $$
  select nome from pastorais order by nome;
$$;
grant execute on function nomes_pastorais() to anon, authenticated;

-- Dados iniciais (lista do Conselho Paroquial de Pastoral, atualizada em 20/01/2026)
insert into pastorais (numero, nome, coordenadores, reunioes, observacao)
select * from (values
  (1, 'Acolhida', '[{"nome": "Abmael", "telefone": "(61) 98175-5106", "email": "abmmael@hotmail.com"}, {"nome": "Danielle", "telefone": "(61) 98162-0659", "email": "danicassia180297@gmail.com"}]'::jsonb, '[{"dia": "2º sábado", "local": "Centro Catequético", "horario": "15h", "observacao": ""}]'::jsonb, null),
  (2, 'Apostolado', '[{"nome": "Marta", "telefone": "(61) 99970-2823", "email": "mnorbelia@gmail.com"}, {"nome": "Jaqueline Barbosa", "telefone": "(61) 99965-0717", "email": ""}]'::jsonb, '[{"dia": "1ª sexta-feira", "local": "Capela", "horario": "17h30", "observacao": ""}, {"dia": "Último sábado", "local": "Sala 07", "horario": "15h", "observacao": ""}]'::jsonb, null),
  (3, 'Batismo', '[{"nome": "Jacira", "telefone": "(61) 98471-4929", "email": "jacirapsantos@gmail.com"}, {"nome": "Vanderli", "telefone": "(61) 98472-4521", "email": "cesario.27@hotmail.com"}]'::jsonb, '[{"dia": "1ª quinta-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (4, 'Catequese', '[{"nome": "Nelma Eleoterio", "telefone": "(61) 99972-9573", "email": "nelmacastrodf@yahoo.com.br"}, {"nome": "Rafael Almeida", "telefone": "(61) 98413-5835", "email": "rafaelalmeida96@gmail.com"}]'::jsonb, '[{"dia": "Quando necessário", "local": "", "horario": "", "observacao": ""}]'::jsonb, null),
  (5, 'Cerimoniários', '[{"nome": "Pedro Henrique", "telefone": "(61) 98632-5266", "email": "pedrohenrique.eb.mil@gmail.com"}, {"nome": "Paulo José", "telefone": "(61) 98606-4545", "email": "paulo.jmodesto75@gmail.com"}]'::jsonb, '[{"dia": "Último sábado", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (6, 'Comunicação - PASCOM', '[{"nome": "Lidieth Bettina R. Sanches", "telefone": "(61) 99246-7161", "email": "sanchezlidieth93@gmail.com"}, {"nome": "João Paulo", "telefone": "(61) 99212-9996", "email": "santiagojp@gmail.com"}]'::jsonb, '[{"dia": "Dia 20", "local": "Igreja", "horario": "19h", "observacao": ""}]'::jsonb, null),
  (7, 'Coroinhas', '[{"nome": "Dalise Keila de S. Correa", "telefone": "(61) 98270-1570", "email": "0909.keila@gmail.com"}, {"nome": "Regina Resende", "telefone": "(61) 98603-8335", "email": "contatorlwp@gmail.com"}]'::jsonb, '[{"dia": "Última segunda-feira", "local": "Sala 108", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (8, 'Cursilho - MCC/GED', '[{"nome": "Jerolino Pereira", "telefone": "(61) 99105-9671", "email": "jerolino.pereira@gmail.com"}, {"nome": "Flávio", "telefone": "(61) 99260-8989", "email": "flaviodsa@gmail.com"}]'::jsonb, '[{"dia": "1ª segunda-feira", "local": "Sala 07", "horario": "20h", "observacao": ""}, {"dia": "Quarta-feira", "local": "", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (9, 'Dízimo', '[{"nome": "Jorge", "telefone": "(61) 99987-1990", "email": "pdizimosaojose@gmail.com"}]'::jsonb, '[{"dia": "Último sábado", "local": "Sala do dízimo", "horario": "09h", "observacao": ""}]'::jsonb, null),
  (10, 'ECC', '[{"nome": "Cláudio Nobre", "telefone": "(61) 98126-4710", "email": "juniornobre@gmail.com"}, {"nome": "Rozana Raulino", "telefone": "(61) 99977-8309", "email": "rozanaraulino@gmail.com"}]'::jsonb, '[{"dia": "Quarta-feira", "local": "Casa dos membros", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (11, 'Escola da Fé', '[{"nome": "Cleide Maria de Sanctis", "telefone": "(61) 99253-8583", "email": "cleidesanctis@gmail.com"}]'::jsonb, '[{"dia": "Quarta-feira", "local": "Sala 107", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (12, 'Eventos', '[{"nome": "Francisco", "telefone": "(61) 98466-9684", "email": "francisco.nina.cabral@gmail.com"}, {"nome": "Rodrigo", "telefone": "(61) 98546-4510", "email": ""}]'::jsonb, '[{"dia": "Quando necessário", "local": "", "horario": "", "observacao": ""}]'::jsonb, null),
  (13, 'Familiar', '[{"nome": "Divino", "telefone": "(61) 98206-9088", "email": "pastoralfamiliarpsjtag@gmail.com"}, {"nome": "Sueli", "telefone": "", "email": ""}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala 07", "horario": "19h45", "observacao": ""}]'::jsonb, null),
  (14, 'FUC', '[{"nome": "Eduardo", "telefone": "(61) 98346-9819", "email": "eduardodev18@gmail.com"}, {"nome": "Vinicius", "telefone": "(61) 98199-5046", "email": "viniciusrangel1802@gmail.com"}]'::jsonb, '[{"dia": "Sábado", "local": "Sala superior", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (15, 'JAUC', '[{"nome": "Vitoria", "telefone": "(61) 99361-6521", "email": "vitoria.cristina2002@gmail.com"}, {"nome": "Felipe Gontijo", "telefone": "(61) 99915-3803", "email": "felipegontijotrigueiro@gmail.com"}]'::jsonb, '[{"dia": "Domingo", "local": "Centro Catequético", "horario": "18h30", "observacao": ""}]'::jsonb, null),
  (16, 'Legião de Maria', '[{"nome": "Terezinha", "telefone": "(61) 99988-3738", "email": "maedobomconselho@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala 08", "horario": "8h30", "observacao": ""}]'::jsonb, null),
  (17, 'Liturgia', '[{"nome": "Lindomar Borges", "telefone": "(61) 99808-2057", "email": "lindomar.catolico@gmail.com"}]'::jsonb, '[{"dia": "Terça-feira", "local": "Sala da Liturgia", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (18, 'Mãe Peregrina', '[{"nome": "Patrícia Ferreira", "telefone": "(61) 98623-8459", "email": "fpatriciaferreira43@gmail.com"}, {"nome": "Aparecida Martins", "telefone": "(61) 98468-8037", "email": ""}]'::jsonb, '[{"dia": "2º sábado", "local": "Centro Catequético", "horario": "15h", "observacao": ""}, {"dia": "Dia 18", "local": "Igreja", "horario": "19h", "observacao": "Missa"}]'::jsonb, null),
  (19, 'Mães que Oram pelos Filhos', '[{"nome": "Mary Caixeta Marinho", "telefone": "(61) 98114-8484", "email": "marycmarinho@gmail.com"}]'::jsonb, '[{"dia": "Quinta-feira", "local": "Sala 07", "horario": "17h45", "observacao": ""}]'::jsonb, null),
  (20, 'MESCE', '[{"nome": "Cícero Adriano", "telefone": "(61) 98136-5279", "email": "ciceroadrianobr@gmail.com"}, {"nome": "Dora Garcia", "telefone": "", "email": ""}]'::jsonb, '[{"dia": "3ª segunda-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (21, 'Oficinas de Oração e Vida', '[{"nome": "Kátia Severo", "telefone": "(61) 98513-9194", "email": "katiasevero@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Centro Catequético", "horario": "19h30", "observacao": ""}]'::jsonb, null),
  (22, 'Pastoral de Quadras', '[{"nome": "Lindomar Borges", "telefone": "(61) 99808-2057", "email": "lindomar.catolico@gmail.com"}]'::jsonb, '[{"dia": "Última sexta-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (23, 'Pessoa Idosa - PPI', '[{"nome": "Lindaura Carolina", "telefone": "(61) 99187-9329 / (61) 3963-3470", "email": "lindauracarolina59@gmail.com"}]'::jsonb, '[{"dia": "Quando necessário", "local": "", "horario": "", "observacao": ""}]'::jsonb, null),
  (24, 'RCC', '[{"nome": "Danielle Alves", "telefone": "(61) 99163-2885", "email": "danidaniellealves@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala 02", "horario": "", "observacao": ""}, {"dia": "Terça-feira", "local": "Igreja", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (25, 'Saúde', '[{"nome": "Conceição", "telefone": "(61) 98141-5669", "email": "conceicao1706@hotmail.com"}]'::jsonb, '[{"dia": "2ª quinta-feira", "local": "", "horario": "19h", "observacao": "Reunião"}, {"dia": "Quarta-feira", "local": "HRT", "horario": "", "observacao": "Visitas"}]'::jsonb, null),
  (26, 'Vocacional', '[{"nome": "Marcos", "telefone": "(61) 99260-8962", "email": "marcos@tarcianaaraujo.com.br"}, {"nome": "Tarciana", "telefone": "(61) 99975-5859", "email": "tarciana@tarcianaaraujo.com.br"}]'::jsonb, '[{"dia": "Última segunda-feira", "local": "Santíssimo", "horario": "20h", "observacao": ""}, {"dia": "1º domingo", "local": "Igreja", "horario": "19h", "observacao": "Missa"}]'::jsonb, null),
  (27, 'Terço dos Homens', '[{"nome": "Alino Donizette", "telefone": "(61) 99981-0662", "email": "alinodqueiroz@gmail.com"}, {"nome": "Palmerio Peixoto", "telefone": "(61) 99989-1952", "email": "palmerio.carmo@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (28, 'Vicentinos', '[{"nome": "Jaques N. de Freitas", "telefone": "(61) 99961-4736", "email": "jaquesnfreitas@gmail.com"}, {"nome": "Simone Silva da Costa", "telefone": "(61) 98416-1063", "email": ""}, {"nome": "Ana Nery de L. Caixeta", "telefone": "(61) 98444-4184", "email": ""}, {"nome": "Ailton Angelo da Silva", "telefone": "(61) 98578-3305", "email": "ailtonangelosjunior@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala dos Vicentinos", "horario": "20h", "observacao": "Conf. S. J. Batista"}, {"dia": "Quinta-feira", "local": "Sala dos Vicentinos", "horario": "20h", "observacao": "Conf. São José"}, {"dia": "Quinta-feira", "local": "Sala dos Vicentinos", "horario": "19h", "observacao": "Conf. Santa Luzia"}, {"dia": "Terça-feira", "local": "Sala dos Vicentinos", "horario": "19h", "observacao": "Conf. Imaculada Conceição"}]'::jsonb, 'Reunião geral no 4º sábado.')
) as v(numero, nome, coordenadores, reunioes, observacao)
where not exists (select 1 from pastorais);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-acesso.sql

-- =====================================================================
-- atualizacao-acesso.sql — novo modelo de acesso
--   * Cada pastoral, grupo ou movimento tem UM login (e-mail + senha),
--     criado e mantido pela secretaria no cadastro de Pastorais.
--   * Não paroquiano pede a sala SEM login; acompanha e cancela pelo
--     link secreto do comprovante. 1 pedido pendente por telefone.
--   * Direcionamento Espiritual SEM login. 1 pedido pendente por telefone.
-- Rode no SQL Editor depois de pastorais.sql. Pode ser executado de novo.
-- Depois, desligue o cadastro livre no painel do Supabase
-- (Authentication > Sign In / Providers > "Allow new users to sign up").
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------
alter table pastorais add column if not exists login_email  text;
alter table pastorais add column if not exists senha_acesso text;
alter table pastorais add column if not exists user_id      uuid;
alter table pastorais drop constraint if exists pastorais_user_id_fkey;
alter table pastorais add constraint pastorais_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
create unique index if not exists pastorais_user_unico  on pastorais (user_id) where user_id is not null;
create unique index if not exists pastorais_login_unico on pastorais (lower(login_email)) where login_email is not null;

-- Código secreto do comprovante dos pedidos feitos sem login
alter table reservas add column if not exists token text;
create unique index if not exists reservas_token_idx on reservas (token, turno_id) where token is not null;

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function so_digitos(t text)
returns text language sql immutable as $$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

-- Encerra as sessões abertas de uma conta (troca de senha ou exclusão)
create or replace function encerrar_sessoes(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  begin
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
  exception when others then
    null;   -- se o Supabase não permitir, as sessões terminam sozinhas ao expirar
  end;
end;
$$;

-- A sessão usada ainda vale? (depois de trocar a senha, a antiga deixa de valer)
create or replace function sessao_valida()
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare v_sid text := auth.jwt() ->> 'session_id';
begin
  if v_sid is null then return true; end if;
  return exists (select 1 from auth.sessions where id::text = v_sid);
exception when others then
  return true;
end;
$$;

-- Nome da pastoral da conta conectada (mostrado no topo do site e usado nas reservas)
create or replace function minha_pastoral()
returns text
language sql stable security definer set search_path = public
as $$ select nome from pastorais where user_id = auth.uid() limit 1 $$;

-- ---------------------------------------------------------------------
-- Secretaria: criar ou alterar o login e a senha de uma pastoral
-- ---------------------------------------------------------------------
drop function if exists salvar_acesso_pastoral(bigint, text, text);
create function salvar_acesso_pastoral(p_pastoral bigint, p_email text, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_p     pastorais%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_senha text := coalesce(p_senha, '');
  v_uid   uuid;
  v_outro uuid;
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode criar ou alterar acessos.';
  end if;
  select * into v_p from pastorais where id = p_pastoral;
  if not found then
    raise exception 'Pastoral não encontrada.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido para o login.';
  end if;
  if length(v_senha) < 6 then
    raise exception 'A senha de acesso precisa ter pelo menos 6 caracteres.';
  end if;
  if exists (select 1 from pastorais where lower(login_email) = v_email and id <> p_pastoral) then
    raise exception 'Este e-mail já é o login de outra pastoral.';
  end if;

  select id into v_outro from auth.users where lower(email) = v_email limit 1;

  if v_p.user_id is not null then
    -- Conta já existe: altera o e-mail e/ou a senha
    if v_outro is not null and v_outro <> v_p.user_id then
      raise exception 'Este e-mail já é usado por outra conta do sistema.';
    end if;
    update auth.users
       set email = v_email,
           encrypted_password = case when v_p.senha_acesso is distinct from v_senha
                                     then crypt(v_senha, gen_salt('bf')) else encrypted_password end,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_p.user_id;
    update auth.identities
       set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email, 'email_verified', true),
           updated_at = now()
     where user_id = v_p.user_id and provider = 'email';
    update solicitantes set email = v_email where id = v_p.user_id;
    if v_p.senha_acesso is distinct from v_senha or lower(coalesce(v_p.login_email, '')) <> v_email then
      perform encerrar_sessoes(v_p.user_id);
    end if;
    v_uid := v_p.user_id;
  else
    if v_outro is not null then
      -- O e-mail já tem conta (cadastro antigo): só pode ser aproveitada se não for da secretaria nem do Pároco
      if exists (select 1 from administradores where user_id = v_outro)
         or exists (select 1 from parocos where user_id = v_outro) then
        raise exception 'Este e-mail é usado pela secretaria ou pelo Pároco. Use outro e-mail para a pastoral.';
      end if;
      if exists (select 1 from pastorais where user_id = v_outro) then
        raise exception 'Este e-mail já é o login de outra pastoral.';
      end if;
      update auth.users
         set encrypted_password = crypt(v_senha, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_outro;
      perform encerrar_sessoes(v_outro);
      v_uid := v_outro;
    else
      -- Cria a conta já confirmada (não envia e-mail)
      v_uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
              crypt(v_senha, gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nome', v_p.nome),
              now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_uid, v_uid::text,
              jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
              'email', now(), now(), now());
    end if;
    insert into solicitantes (id, nome, telefone, email, grupo)
    values (v_uid, '', '', v_email, v_p.nome)
    on conflict (id) do update set email = excluded.email, grupo = excluded.grupo;
  end if;

  update pastorais
     set login_email = v_email, senha_acesso = v_senha, user_id = v_uid
   where id = p_pastoral;
end;
$$;

-- ---------------------------------------------------------------------
-- Secretaria: remover o acesso (apaga o login; as reservas ficam no histórico)
-- ---------------------------------------------------------------------
drop function if exists remover_acesso_pastoral(bigint);
create function remover_acesso_pastoral(p_pastoral bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid;
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode remover acessos.';
  end if;
  select user_id into v_uid from pastorais where id = p_pastoral;
  if not found then
    raise exception 'Pastoral não encontrada.';
  end if;
  update pastorais set login_email = null, senha_acesso = null, user_id = null where id = p_pastoral;
  if v_uid is not null
     and not exists (select 1 from administradores where user_id = v_uid)
     and not exists (select 1 from parocos where user_id = v_uid) then
    perform encerrar_sessoes(v_uid);
    delete from auth.users where id = v_uid;
  end if;
end;
$$;

-- Pastoral excluída do cadastro: o login dela também é apagado
create or replace function pastorais_apagar_conta()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.user_id is not null
     and not exists (select 1 from administradores where user_id = old.user_id)
     and not exists (select 1 from parocos where user_id = old.user_id) then
    perform encerrar_sessoes(old.user_id);
    delete from auth.users where id = old.user_id;
  end if;
  return old;
end;
$$;
drop trigger if exists trg_pastorais_apagar_conta on pastorais;
create trigger trg_pastorais_apagar_conta
  after delete on pastorais
  for each row execute function pastorais_apagar_conta();

-- ---------------------------------------------------------------------
-- A própria conta troca a senha (o cadastro da pastoral é atualizado junto)
-- ---------------------------------------------------------------------
drop function if exists alterar_minha_senha(text);
create function alterar_minha_senha(p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_senha, gen_salt('bf')), updated_at = now()
   where id = auth.uid();
  update pastorais set senha_acesso = p_senha where user_id = auth.uid();
end;
$$;

-- "Nova senha" da aba Contas/Coordenadores também atualiza o cadastro da pastoral
create or replace function definir_senha(p_id uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode definir senhas.';
  end if;
  if p_id = auth.uid() then
    raise exception 'Para trocar a sua própria senha, use "Alterar minha senha" no site.';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_senha, gen_salt('bf')),
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
  update pastorais set senha_acesso = p_senha where user_id = p_id;
  perform encerrar_sessoes(p_id);
end;
$$;

-- Excluir conta pela aba Contas/Coordenadores: limpa o login do cadastro da pastoral
create or replace function excluir_coordenador(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode excluir cadastros.';
  end if;
  if p_id = auth.uid() then
    raise exception 'Você não pode excluir a própria conta.';
  end if;
  if exists (select 1 from administradores where user_id = p_id) then
    raise exception 'Esta conta é da secretaria. Retire o acesso de secretaria antes de excluir.';
  end if;
  update pastorais set login_email = null, senha_acesso = null, user_id = null where user_id = p_id;
  perform encerrar_sessoes(p_id);
  delete from auth.users where id = p_id;
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Reservas
--   * conta de pastoral: o grupo é sempre o nome da pastoral
--   * sem login: só pedido de não paroquiano, 1 pendente por telefone,
--     com código secreto (token) para acompanhar e cancelar
-- ---------------------------------------------------------------------
create or replace function criar_reserva(
  p_sala_id   bigint,
  p_data      date,
  p_turnos    text[],
  p_nome      text,
  p_telefone  text,
  p_grupo     text,
  p_motivo    text,
  p_tipo      text default 'paroquiano',
  p_endereco  text default null,
  p_paroquia  text default null,
  p_paroco    text default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean := is_admin();
  v_sala    salas%rowtype;
  v_turno   turnos%rowtype;
  v_cod     text;
  v_status  text;
  v_inicio  timestamptz;
  v_hoje    date := hoje_sp();
  v_codigo  text;
  v_token   text;
  v_pastoral text;
  v_nome    text := trim(coalesce(p_nome, ''));
  v_fone    text := trim(coalesce(p_telefone, ''));
  v_grupo   text := regexp_replace(trim(coalesce(p_grupo, '')), '\s+', ' ', 'g');
  v_tipo    text := case when p_tipo = 'externo' then 'externo' else 'paroquiano' end;
  v_end     text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq   text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco  text := nullif(trim(coalesce(p_paroco, '')), '');
begin
  if v_uid is null then
    if v_tipo <> 'externo' then
      raise exception 'Entre com o login da sua pastoral, grupo ou movimento para reservar.';
    end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  else
    if not sessao_valida() then
      raise exception 'Sua sessão terminou (a senha foi alterada). Entre novamente.';
    end if;
    if not v_admin then
      v_pastoral := minha_pastoral();
      if v_pastoral is not null then
        v_grupo := v_pastoral;
        v_tipo  := 'paroquiano';
      end if;
    end if;
  end if;

  if v_nome = '' then
    raise exception 'Informe seu nome.';
  end if;
  if length(so_digitos(v_fone)) < 10 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  if v_grupo = '' then
    raise exception 'Informe a pastoral ou o grupo.';
  end if;
  if p_turnos is null or array_length(p_turnos, 1) is null then
    raise exception 'Escolha pelo menos um turno.';
  end if;
  if v_tipo = 'externo' then
    if v_end is null then raise exception 'Informe o endereço.'; end if;
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
  end if;

  select * into v_sala from salas where id = p_sala_id;
  if not found or not v_sala.ativa then
    raise exception 'Sala indisponível para reservas.';
  end if;

  if not v_admin and p_data > v_hoje + cfg('janela_dias')::int then
    raise exception 'A agenda está aberta só para os próximos % dias.', cfg('janela_dias');
  end if;

  perform expirar_pendentes();

  -- Sem login: no máximo 1 pedido aguardando aprovação por telefone
  if v_uid is null and exists (
    select 1 from reservas
     where status = 'pendente' and tipo = 'externo' and solicitante_id is null
       and data >= v_hoje and so_digitos(responsavel_telefone) = so_digitos(v_fone)
  ) then
    raise exception 'Já existe um pedido aguardando aprovação para este telefone. Acompanhe pelo link do comprovante ou aguarde a resposta da secretaria.';
  end if;

  -- Guarda os dados usados, para preencher o formulário da próxima vez
  if v_uid is not null then
    insert into solicitantes (id, nome, telefone, email, grupo)
    values (v_uid, v_nome, v_fone, coalesce((select email from auth.users where id = v_uid), ''), v_grupo)
    on conflict (id) do update set nome = excluded.nome, telefone = excluded.telefone, grupo = excluded.grupo;
  end if;

  -- Pendente: sala controlada (palestra) ou pedido de não paroquiano. A secretaria confirma direto.
  v_status := case when (v_sala.controlada or v_tipo = 'externo') and not v_admin then 'pendente' else 'confirmada' end;

  foreach v_cod in array p_turnos loop
    select * into v_turno from turnos where codigo = v_cod;
    if not found then
      raise exception 'Turno % inválido.', v_cod;
    end if;
    if not (extract(dow from p_data)::int = any (v_turno.dias_semana)) then
      raise exception 'O turno % não funciona neste dia.', v_turno.nome;
    end if;

    v_inicio := (p_data + v_turno.inicio) at time zone 'America/Sao_Paulo';
    if v_admin then
      if v_inicio < now() then
        raise exception 'O turno % já começou.', v_turno.nome;
      end if;
    elsif v_inicio < now() + make_interval(hours => cfg('antecedencia_min_horas')::int) then
      raise exception 'A reserva do turno % precisa de % horas de antecedência.', v_turno.nome, cfg('antecedencia_min_horas');
    end if;

    if exists (
      select 1 from bloqueios b
       where b.sala_id = p_sala_id
         and p_data between b.data_inicio and b.data_fim
         and (b.turnos is null or cardinality(b.turnos) = 0 or v_cod = any (b.turnos))
    ) then
      raise exception 'A sala está bloqueada no turno %.', v_turno.nome;
    end if;

    if v_codigo is null then
      v_codigo := 'SJ-' || to_char(v_hoje, 'YYYY') || '-' || lpad(nextval('reserva_seq')::text, 4, '0');
    end if;

    begin
      insert into reservas (codigo, sala_id, grupo, responsavel_nome, responsavel_telefone, solicitante_id,
                            data, turno_id, motivo, status, aprovado_por, aprovado_em,
                            tipo, endereco, paroquia_origem, paroco_responsavel, token)
      values (v_codigo, p_sala_id, v_grupo, v_nome, v_fone, v_uid, p_data, v_turno.id,
              nullif(trim(p_motivo), ''), v_status,
              case when v_admin and (v_sala.controlada or v_tipo = 'externo') then v_uid end,
              case when v_admin and (v_sala.controlada or v_tipo = 'externo') then now() end,
              v_tipo,
              case when v_tipo = 'externo' then v_end end,
              case when v_tipo = 'externo' then v_paroq end,
              case when v_tipo = 'externo' then v_paroco end,
              v_token);
    exception when unique_violation then
      raise exception 'O turno % acabou de ser reservado por outro grupo.', v_turno.nome;
    end;
  end loop;

  return v_codigo;
end;
$$;

-- Pedido de não paroquiano sem login. Retorna o código secreto do comprovante.
drop function if exists solicitar_reserva_externa(bigint, date, text[], text, text, text, text, text, text, text);
create function solicitar_reserva_externa(
  p_sala_id bigint, p_data date, p_turnos text[], p_nome text, p_telefone text, p_grupo text,
  p_motivo text, p_endereco text, p_paroquia text, p_paroco text
)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_codigo text; v_token text;
begin
  if auth.uid() is not null then
    raise exception 'Para pedir como não paroquiano, saia da conta da pastoral.';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo da reserva.';
  end if;
  v_codigo := criar_reserva(p_sala_id, p_data, p_turnos, p_nome, p_telefone, p_grupo, p_motivo,
                            'externo', p_endereco, p_paroquia, p_paroco);
  select token into v_token from reservas where codigo = v_codigo and token is not null limit 1;
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------
-- Comprovante
--   pelo código: como antes, exceto pedidos feitos sem login (esses só pelo link secreto)
--   pelo link secreto: obter_comprovante_token / cancelar_por_token
-- ---------------------------------------------------------------------
drop function if exists obter_comprovante(text);
create function obter_comprovante(p_codigo text)
returns table (
  codigo text, sala text, capacidade int, controlada boolean, data date, turno text, turno_codigo text,
  inicio time, fim time, grupo text, responsavel text, motivo text, status text, motivo_recusa text,
  regras text, tipo text, paroquia_origem text, itens jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.codigo, coalesce(s.nome, 'Sala ' || s.numero), s.capacidade, s.controlada, r.data,
         t.nome, t.codigo, t.inicio, t.fim, r.grupo,
         split_part(trim(r.responsavel_nome), ' ', 1) ||
           case when position(' ' in trim(r.responsavel_nome)) > 0
                then ' ' || left((string_to_array(trim(r.responsavel_nome), ' '))[array_length(string_to_array(trim(r.responsavel_nome), ' '), 1)], 1) || '.'
                else '' end,
         r.motivo, r.status, r.motivo_recusa, cfg('texto_regras'), r.tipo, r.paroquia_origem, s.itens
    from reservas r
    join salas s  on s.id = r.sala_id
    join turnos t on t.id = r.turno_id
   where r.codigo = upper(trim(p_codigo))
     and (r.token is null or is_admin())
   order by t.ordem;
$$;

drop function if exists obter_comprovante_token(text);
create function obter_comprovante_token(p_token text)
returns table (
  codigo text, sala text, capacidade int, controlada boolean, data date, turno text, turno_codigo text,
  inicio time, fim time, grupo text, responsavel text, motivo text, status text, motivo_recusa text,
  regras text, tipo text, paroquia_origem text, itens jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.codigo, coalesce(s.nome, 'Sala ' || s.numero), s.capacidade, s.controlada, r.data,
         t.nome, t.codigo, t.inicio, t.fim, r.grupo,
         split_part(trim(r.responsavel_nome), ' ', 1) ||
           case when position(' ' in trim(r.responsavel_nome)) > 0
                then ' ' || left((string_to_array(trim(r.responsavel_nome), ' '))[array_length(string_to_array(trim(r.responsavel_nome), ' '), 1)], 1) || '.'
                else '' end,
         r.motivo, r.status, r.motivo_recusa, cfg('texto_regras'), r.tipo, r.paroquia_origem, s.itens
    from reservas r
    join salas s  on s.id = r.sala_id
    join turnos t on t.id = r.turno_id
   where length(coalesce(p_token, '')) >= 32 and r.token = p_token
   order by t.ordem;
$$;

drop function if exists cancelar_por_token(text);
create function cancelar_por_token(p_token text)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_qtd int;
begin
  if length(coalesce(p_token, '')) < 32 or not exists (select 1 from reservas where token = p_token) then
    raise exception 'Pedido não encontrado.';
  end if;
  update reservas r
     set status = 'cancelada'
    from turnos t
   where t.id = r.turno_id
     and r.token = p_token
     and r.status in ('pendente','confirmada')
     and ((r.data + t.inicio) at time zone 'America/Sao_Paulo') > now();
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then
    raise exception 'Este pedido não pode mais ser cancelado (já começou, já passou ou já foi encerrado).';
  end if;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------
-- Direcionamento Espiritual sem login: 1 pedido aguardando por telefone
-- ---------------------------------------------------------------------
create or replace function solicitar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_id     bigint;
begin
  if p_tipo = 'externo' then
    raise exception 'O Direcionamento Espiritual é exclusivo para paroquianos. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo not in ('paroquiano','enfermo') then
    raise exception 'Escolha para quem é o atendimento.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(so_digitos(v_fone)) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if v_end is null then raise exception 'Informe o endereço.'; end if;
  if p_tipo = 'enfermo' and v_local is null then raise exception 'Informe o local onde o enfermo se encontra.'; end if;
  if not endereco_na_area(v_end) then
    raise exception 'Este endereço não pertence à área de atendimento da Paróquia São José (QND e QNE). Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;

  if (p_data + p_inicio) <= v_agora then
    raise exception 'Este horário já passou.';
  end if;
  if p_data > v_agora::date + 30 then
    raise exception 'Os pedidos ficam abertos para os próximos 30 dias.';
  end if;

  -- No máximo 1 pedido aguardando confirmação por telefone
  if exists (select 1 from atendimentos
              where so_digitos(telefone) = so_digitos(v_fone)
                and data >= v_agora::date
                and status in ('pendente','solicitado')) then
    raise exception 'Já existe um pedido aguardando confirmação para este telefone. Aguarde a resposta pelo WhatsApp ou fale com a secretaria paroquial.';
  end if;

  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário não está disponível.';
  end if;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento,
                              paroquia_origem, paroco_responsavel, status, criado_por)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            null, null, 'solicitado', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.';
  end;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function encerrar_sessoes(uuid) from public, anon, authenticated;
revoke execute on function salvar_acesso_pastoral(bigint, text, text) from public, anon;
revoke execute on function remover_acesso_pastoral(bigint) from public, anon;
revoke execute on function alterar_minha_senha(text) from public, anon;
revoke execute on function minha_pastoral() from public, anon;
revoke execute on function criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function pastorais_apagar_conta() from public, anon, authenticated;

grant execute on function sessao_valida() to authenticated;
grant execute on function minha_pastoral() to authenticated;
grant execute on function salvar_acesso_pastoral(bigint, text, text) to authenticated;
grant execute on function remover_acesso_pastoral(bigint) to authenticated;
grant execute on function alterar_minha_senha(text) to authenticated;
grant execute on function criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text) to authenticated;
grant execute on function solicitar_reserva_externa(bigint, date, text[], text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function obter_comprovante(text) to anon, authenticated;
grant execute on function obter_comprovante_token(text) to anon, authenticated;
grant execute on function cancelar_por_token(text) to anon, authenticated;
grant execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-endereco.sql

-- =====================================================================
-- atualizacao-endereco.sql — endereço completo no Direcionamento Espiritual
--   Aceita: QND/QNE + quadra, [Conjunto X], e depois Casa N  ou  Lote N + Apt N/Casa N
--   Ex.: QND 57 Casa 06 · QND 57 Conjunto A Casa 06 · QNE 07 Lote 2 Apt 102
--   Abreviações: conj/cj = Conjunto, cs = Casa, lt = Lote, ap/apto = Apt
-- Rode no SQL Editor depois de atualizacao-acesso.sql. Pode ser executado de novo.
-- =====================================================================

-- Padroniza o texto: maiúsculas, sem acento, palavras e números separados, abreviações por extenso
create or replace function endereco_normalizado(p_endereco text)
returns text
language plpgsql immutable
as $$
declare s text := upper(coalesce(p_endereco, ''));
begin
  s := translate(s, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC');
  s := regexp_replace(s, '[^A-Z0-9]+', ' ', 'g');
  s := regexp_replace(s, '([A-Z])([0-9])', '\1 \2', 'g');
  s := regexp_replace(s, '([0-9])([A-Z])', '\1 \2', 'g');
  s := regexp_replace(trim(s), '\s+', ' ', 'g');
  s := regexp_replace(s, '^Q ?N ?([DE])(\s|$)', 'QN\1\2');
  s := regexp_replace(s, '\m(CONJ|CJ)\M', 'CONJUNTO', 'g');
  s := regexp_replace(s, '\mCS\M', 'CASA', 'g');
  s := regexp_replace(s, '\mLT\M', 'LOTE', 'g');
  s := regexp_replace(s, '\m(APARTAMENTO|APTO|AP)\M', 'APT', 'g');
  return s;
end;
$$;

-- 'ok' (endereço completo da área), 'incompleto' (QND/QNE sem casa ou lote) ou 'fora' (outra região)
create or replace function endereco_situacao(p_endereco text)
returns text
language sql immutable
as $$
  select case
    when endereco_normalizado(p_endereco) ~ '^QN[DE] [0-9]{1,3}( CONJUNTO [A-Z0-9]{1,3})? (CASA [0-9]{1,4}|LOTE [0-9]{1,4} (APT|CASA) [0-9]{1,4})( .*)?$' then 'ok'
    when endereco_normalizado(p_endereco) ~ '^QN[DE]( |$)' then 'incompleto'
    else 'fora'
  end;
$$;

-- Texto guardado no pedido: "QND 57 Conjunto A Casa 06"
create or replace function endereco_formatado(p_endereco text)
returns text
language sql immutable
as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           endereco_normalizado(p_endereco),
           '\mCONJUNTO\M', 'Conjunto', 'g'), '\mCASA\M', 'Casa', 'g'), '\mLOTE\M', 'Lote', 'g'), '\mAPT\M', 'Apt', 'g');
$$;

-- Mantida por compatibilidade: só endereço completo da área conta como "na área"
create or replace function endereco_na_area(p_endereco text)
returns boolean
language sql immutable
as $$ select endereco_situacao(p_endereco) = 'ok' $$;

create or replace function solicitar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_id     bigint;
begin
  if p_tipo = 'externo' then
    raise exception 'O Direcionamento Espiritual é exclusivo para paroquianos. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo not in ('paroquiano','enfermo') then
    raise exception 'Escolha para quem é o atendimento.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(so_digitos(v_fone)) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if v_end is null then raise exception 'Informe o endereço.'; end if;
  if p_tipo = 'enfermo' and v_local is null then raise exception 'Informe o local onde o enfermo se encontra.'; end if;
  if endereco_situacao(v_end) = 'fora' then
    raise exception 'O endereço informado não pertence à área de atendimento da Paróquia São José. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if endereco_situacao(v_end) = 'incompleto' then
    raise exception 'Informe o endereço completo: quadra e número da casa, ou lote e apartamento. Ex.: QND XX Casa XX';
  end if;

  if (p_data + p_inicio) <= v_agora then
    raise exception 'Este horário já passou.';
  end if;
  if p_data > v_agora::date + 30 then
    raise exception 'Os pedidos ficam abertos para os próximos 30 dias.';
  end if;

  -- No máximo 1 pedido aguardando confirmação por telefone
  if exists (select 1 from atendimentos
              where so_digitos(telefone) = so_digitos(v_fone)
                and data >= v_agora::date
                and status in ('pendente','solicitado')) then
    raise exception 'Já existe um pedido aguardando confirmação para este telefone. Aguarde a resposta pelo WhatsApp ou fale com a secretaria paroquial.';
  end if;

  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário não está disponível.';
  end if;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento,
                              paroquia_origem, paroco_responsavel, status, criado_por)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            null, null, 'solicitado', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.';
  end;
  return v_id;
end;
$$;

grant execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text) to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-incrementos.sql

-- =====================================================================
-- atualizacao-incrementos.sql
--   * Telefone da secretaria: (61) 3354-2921 (rodapé e mensagens)
--   * Direcionamento: paroquiano informa a Pastoral, Movimento ou Grupo
--     (conferida com o cadastro) ou "Não participo de pastoral"
--   * Um mesmo e-mail pode ser o login de várias pastorais (senha única)
-- Rode no SQL Editor depois de atualizacao-endereco.sql. Pode ser executado de novo.
-- =====================================================================

-- Telefone da secretaria paroquial
insert into configuracoes (chave, valor, descricao)
values ('telefone_secretaria', '(61) 3354-2921', 'Telefone da secretaria paroquial')
on conflict (chave) do update set valor = excluded.valor;

-- Nome comparável: sem acento, sem diferença de maiúsculas e espaços
create or replace function nome_comparavel(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(translate(trim(coalesce(t, '')),
         'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
         'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g')
$$;

-- ---------------------------------------------------------------------
-- Direcionamento: pastoral informada no pedido
-- ---------------------------------------------------------------------
alter table atendimentos add column if not exists pastoral text;

drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text);
drop function if exists solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text, text);
create function solicitar_atendimento(
  p_data      date,
  p_inicio    time,
  p_fim       time,
  p_nome      text,
  p_telefone  text,
  p_tipo      text,
  p_assunto   text,
  p_endereco  text,
  p_paroquia  text,
  p_paroco    text,
  p_local     text default null,
  p_pastoral  text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_nome   text := trim(coalesce(p_nome, ''));
  v_fone   text := trim(coalesce(p_telefone, ''));
  v_end    text := nullif(trim(coalesce(p_endereco, '')), '');
  v_local  text := nullif(trim(coalesce(p_local, '')), '');
  v_pub    text;
  v_past   text;
  v_id     bigint;
begin
  if p_tipo = 'externo' then
    raise exception 'O Direcionamento Espiritual é exclusivo para paroquianos. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if p_tipo not in ('paroquiano','enfermo') then
    raise exception 'Escolha para quem é o atendimento.';
  end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if length(so_digitos(v_fone)) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if v_end is null then raise exception 'Informe o endereço.'; end if;
  if p_tipo = 'enfermo' and v_local is null then raise exception 'Informe o local onde o enfermo se encontra.'; end if;
  if endereco_situacao(v_end) = 'fora' then
    raise exception 'O endereço informado não pertence à área de atendimento da Paróquia São José. Procure a paróquia e o pároco responsáveis pela região onde você mora.';
  end if;
  if endereco_situacao(v_end) = 'incompleto' then
    raise exception 'Informe o endereço completo: quadra e número da casa, ou lote e apartamento. Ex.: QND XX Casa XX';
  end if;

  -- Paroquiano informa a pastoral, movimento ou grupo de que participa (ou que não participa)
  if p_tipo = 'paroquiano' then
    if nullif(trim(coalesce(p_pastoral, '')), '') is null then
      raise exception 'Informe a Pastoral, Movimento ou Grupo de que participa, ou marque "Não participo de pastoral".';
    end if;
    if p_pastoral = '__nenhuma__' then
      v_past := 'Não participa de pastoral';
    else
      select nome into v_past from pastorais where nome_comparavel(nome) = nome_comparavel(p_pastoral) limit 1;
      if v_past is null then
        raise exception 'Pastoral, Movimento ou Grupo - INVÁLIDO. Digite corretamente o nome ou entre em contato com a secretaria Paroquial %', cfg('telefone_secretaria');
      end if;
    end if;
  end if;

  if (p_data + p_inicio) <= v_agora then
    raise exception 'Este horário já passou.';
  end if;
  if p_data > v_agora::date + 30 then
    raise exception 'Os pedidos ficam abertos para os próximos 30 dias.';
  end if;

  -- No máximo 1 pedido aguardando confirmação por telefone
  if exists (select 1 from atendimentos
              where so_digitos(telefone) = so_digitos(v_fone)
                and data >= v_agora::date
                and status in ('pendente','solicitado')) then
    raise exception 'Já existe um pedido aguardando confirmação para este telefone. Aguarde a resposta pelo WhatsApp ou fale com a secretaria paroquial %.', cfg('telefone_secretaria');
  end if;

  select publico into v_pub
    from atend_horarios
   where ativo and dia_semana = extract(dow from p_data)::int
     and p_inicio >= inicio and p_fim <= fim
   limit 1;
  if v_pub is null then
    raise exception 'Este horário não faz parte da agenda de atendimentos.';
  end if;
  if v_pub = 'enfermos' and p_tipo <> 'enfermo' then
    raise exception 'Este horário é reservado ao atendimento de enfermos.';
  end if;
  if v_pub = 'paroquianos' and p_tipo = 'enfermo' then
    raise exception 'Atendimento a enfermos é feito no horário próprio para enfermos.';
  end if;

  if exists (
    select 1 from atend_bloqueios b
     where p_data between b.data_inicio and b.data_fim
       and (b.inicio is null or (p_inicio < coalesce(b.fim, '24:00') and p_fim > b.inicio))
  ) then
    raise exception 'Este horário não está disponível.';
  end if;

  begin
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, local_atendimento,
                              paroquia_origem, paroco_responsavel, status, criado_por, pastoral)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
            case when p_tipo = 'enfermo' then v_local end,
            null, null, 'solicitado', auth.uid(), v_past)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.';
  end;
  return v_id;
end;
$$;
grant execute on function solicitar_atendimento(date, time, time, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Mesmo login (e-mail) em várias pastorais
-- ---------------------------------------------------------------------
drop index if exists pastorais_user_unico;
drop index if exists pastorais_login_unico;
create index if not exists pastorais_user_idx on pastorais (user_id);

-- Pastorais da conta conectada (para escolher em nome de qual reservar)
create or replace function minhas_pastorais()
returns setof text
language sql stable security definer set search_path = public
as $$ select nome from pastorais where user_id = auth.uid() order by nome $$;

create or replace function minha_pastoral()
returns text
language sql stable security definer set search_path = public
as $$ select nome from pastorais where user_id = auth.uid() order by nome limit 1 $$;

-- Apaga a conta que ficou sem pastoral (nunca a da secretaria ou do Pároco)
create or replace function apagar_conta_sem_pastoral(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null
     or exists (select 1 from pastorais where user_id = p_user)
     or exists (select 1 from administradores where user_id = p_user)
     or exists (select 1 from parocos where user_id = p_user) then
    return;
  end if;
  perform encerrar_sessoes(p_user);
  delete from auth.users where id = p_user;
end;
$$;

drop function if exists salvar_acesso_pastoral(bigint, text, text);
create function salvar_acesso_pastoral(p_pastoral bigint, p_email text, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_p      pastorais%rowtype;
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_senha  text := coalesce(p_senha, '');
  v_alvo   uuid;
  v_antigo uuid;
  v_mudou  boolean := false;
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode criar ou alterar acessos.';
  end if;
  select * into v_p from pastorais where id = p_pastoral;
  if not found then
    raise exception 'Pastoral não encontrada.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido para o login.';
  end if;
  if length(v_senha) < 6 then
    raise exception 'A senha de acesso precisa ter pelo menos 6 caracteres.';
  end if;
  v_antigo := v_p.user_id;

  -- Conta que vai atender este e-mail
  select id into v_alvo from auth.users where lower(email) = v_email limit 1;
  if v_alvo is not null then
    if exists (select 1 from administradores where user_id = v_alvo)
       or exists (select 1 from parocos where user_id = v_alvo) then
      raise exception 'Este e-mail é usado pela secretaria ou pelo Pároco. Use outro e-mail para a pastoral.';
    end if;
  elsif v_antigo is not null and not exists (select 1 from pastorais where user_id = v_antigo and id <> p_pastoral) then
    -- Só esta pastoral usa a conta: troca o e-mail da própria conta
    update auth.users set email = v_email, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_antigo;
    update auth.identities
       set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email, 'email_verified', true),
           updated_at = now()
     where user_id = v_antigo and provider = 'email';
    update solicitantes set email = v_email where id = v_antigo;
    v_alvo := v_antigo;
    v_mudou := true;
  else
    -- Cria a conta já confirmada (não envia e-mail)
    v_alvo := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', v_alvo, 'authenticated', 'authenticated', v_email,
            crypt(v_senha, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nome', v_p.nome),
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_alvo, v_alvo::text,
            jsonb_build_object('sub', v_alvo::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
    insert into solicitantes (id, nome, telefone, email, grupo)
    values (v_alvo, '', '', v_email, v_p.nome)
    on conflict (id) do update set email = excluded.email;
  end if;

  -- Senha única da conta: vale para todas as pastorais deste login
  if not exists (select 1 from auth.users where id = v_alvo and encrypted_password = crypt(v_senha, encrypted_password)) then
    update auth.users set encrypted_password = crypt(v_senha, gen_salt('bf')),
                          email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_alvo;
    v_mudou := true;
  end if;

  update pastorais set user_id = v_alvo, login_email = v_email where id = p_pastoral;
  update pastorais set senha_acesso = v_senha, login_email = v_email where user_id = v_alvo;

  if v_mudou or v_antigo is distinct from v_alvo then
    perform encerrar_sessoes(v_alvo);
  end if;
  if v_antigo is not null and v_antigo <> v_alvo then
    perform apagar_conta_sem_pastoral(v_antigo);
  end if;
end;
$$;

drop function if exists remover_acesso_pastoral(bigint);
create function remover_acesso_pastoral(p_pastoral bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid;
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode remover acessos.';
  end if;
  select user_id into v_uid from pastorais where id = p_pastoral;
  if not found then
    raise exception 'Pastoral não encontrada.';
  end if;
  update pastorais set login_email = null, senha_acesso = null, user_id = null where id = p_pastoral;
  perform apagar_conta_sem_pastoral(v_uid);   -- a conta só é apagada se não sobrar outra pastoral
end;
$$;

create or replace function pastorais_apagar_conta()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform apagar_conta_sem_pastoral(old.user_id);
  return old;
end;
$$;

-- ---------------------------------------------------------------------
-- Reservas: conta de várias pastorais escolhe em nome de qual reserva
-- ---------------------------------------------------------------------
create or replace function criar_reserva(
  p_sala_id   bigint,
  p_data      date,
  p_turnos    text[],
  p_nome      text,
  p_telefone  text,
  p_grupo     text,
  p_motivo    text,
  p_tipo      text default 'paroquiano',
  p_endereco  text default null,
  p_paroquia  text default null,
  p_paroco    text default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean := is_admin();
  v_sala    salas%rowtype;
  v_turno   turnos%rowtype;
  v_cod     text;
  v_status  text;
  v_inicio  timestamptz;
  v_hoje    date := hoje_sp();
  v_codigo  text;
  v_token   text;
  v_pastoral text;
  v_nome    text := trim(coalesce(p_nome, ''));
  v_fone    text := trim(coalesce(p_telefone, ''));
  v_grupo   text := regexp_replace(trim(coalesce(p_grupo, '')), '\s+', ' ', 'g');
  v_tipo    text := case when p_tipo = 'externo' then 'externo' else 'paroquiano' end;
  v_end     text := nullif(trim(coalesce(p_endereco, '')), '');
  v_paroq   text := nullif(trim(coalesce(p_paroquia, '')), '');
  v_paroco  text := nullif(trim(coalesce(p_paroco, '')), '');
begin
  if v_uid is null then
    if v_tipo <> 'externo' then
      raise exception 'Entre com o login da sua pastoral, grupo ou movimento para reservar.';
    end if;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  else
    if not sessao_valida() then
      raise exception 'Sua sessão terminou (a senha foi alterada). Entre novamente.';
    end if;
    if not v_admin and exists (select 1 from pastorais where user_id = v_uid) then
      -- Conta de pastoral: reserva sempre em nome de uma das pastorais deste login
      select nome into v_pastoral from pastorais
       where user_id = v_uid and nome_comparavel(nome) = nome_comparavel(v_grupo) limit 1;
      if v_pastoral is null then
        if (select count(*) from pastorais where user_id = v_uid) = 1 then
          select nome into v_pastoral from pastorais where user_id = v_uid;
        else
          raise exception 'Escolha em nome de qual pastoral, movimento ou grupo é a reserva.';
        end if;
      end if;
      v_grupo := v_pastoral;
      v_tipo  := 'paroquiano';
    end if;
  end if;

  if v_nome = '' then
    raise exception 'Informe seu nome.';
  end if;
  if length(so_digitos(v_fone)) < 10 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  if v_grupo = '' then
    raise exception 'Informe a pastoral ou o grupo.';
  end if;
  if p_turnos is null or array_length(p_turnos, 1) is null then
    raise exception 'Escolha pelo menos um turno.';
  end if;
  if v_tipo = 'externo' then
    if v_end is null then raise exception 'Informe o endereço.'; end if;
    if v_paroq is null then raise exception 'Informe a paróquia em que atua.'; end if;
    if v_paroco is null then raise exception 'Informe o nome do pároco responsável.'; end if;
  end if;

  select * into v_sala from salas where id = p_sala_id;
  if not found or not v_sala.ativa then
    raise exception 'Sala indisponível para reservas.';
  end if;

  if not v_admin and p_data > v_hoje + cfg('janela_dias')::int then
    raise exception 'A agenda está aberta só para os próximos % dias.', cfg('janela_dias');
  end if;

  perform expirar_pendentes();

  -- Sem login: no máximo 1 pedido aguardando aprovação por telefone
  if v_uid is null and exists (
    select 1 from reservas
     where status = 'pendente' and tipo = 'externo' and solicitante_id is null
       and data >= v_hoje and so_digitos(responsavel_telefone) = so_digitos(v_fone)
  ) then
    raise exception 'Já existe um pedido aguardando aprovação para este telefone. Acompanhe pelo link do comprovante ou fale com a secretaria paroquial %.', cfg('telefone_secretaria');
  end if;

  -- Guarda os dados usados, para preencher o formulário da próxima vez
  if v_uid is not null then
    insert into solicitantes (id, nome, telefone, email, grupo)
    values (v_uid, v_nome, v_fone, coalesce((select email from auth.users where id = v_uid), ''), v_grupo)
    on conflict (id) do update set nome = excluded.nome, telefone = excluded.telefone, grupo = excluded.grupo;
  end if;

  -- Pendente: sala controlada (palestra) ou pedido de não paroquiano. A secretaria confirma direto.
  v_status := case when (v_sala.controlada or v_tipo = 'externo') and not v_admin then 'pendente' else 'confirmada' end;

  foreach v_cod in array p_turnos loop
    select * into v_turno from turnos where codigo = v_cod;
    if not found then
      raise exception 'Turno % inválido.', v_cod;
    end if;
    if not (extract(dow from p_data)::int = any (v_turno.dias_semana)) then
      raise exception 'O turno % não funciona neste dia.', v_turno.nome;
    end if;

    v_inicio := (p_data + v_turno.inicio) at time zone 'America/Sao_Paulo';
    if v_admin then
      if v_inicio < now() then
        raise exception 'O turno % já começou.', v_turno.nome;
      end if;
    elsif v_inicio < now() + make_interval(hours => cfg('antecedencia_min_horas')::int) then
      raise exception 'A reserva do turno % precisa de % horas de antecedência.', v_turno.nome, cfg('antecedencia_min_horas');
    end if;

    if exists (
      select 1 from bloqueios b
       where b.sala_id = p_sala_id
         and p_data between b.data_inicio and b.data_fim
         and (b.turnos is null or cardinality(b.turnos) = 0 or v_cod = any (b.turnos))
    ) then
      raise exception 'A sala está bloqueada no turno %.', v_turno.nome;
    end if;

    if v_codigo is null then
      v_codigo := 'SJ-' || to_char(v_hoje, 'YYYY') || '-' || lpad(nextval('reserva_seq')::text, 4, '0');
    end if;

    begin
      insert into reservas (codigo, sala_id, grupo, responsavel_nome, responsavel_telefone, solicitante_id,
                            data, turno_id, motivo, status, aprovado_por, aprovado_em,
                            tipo, endereco, paroquia_origem, paroco_responsavel, token)
      values (v_codigo, p_sala_id, v_grupo, v_nome, v_fone, v_uid, p_data, v_turno.id,
              nullif(trim(p_motivo), ''), v_status,
              case when v_admin and (v_sala.controlada or v_tipo = 'externo') then v_uid end,
              case when v_admin and (v_sala.controlada or v_tipo = 'externo') then now() end,
              v_tipo,
              case when v_tipo = 'externo' then v_end end,
              case when v_tipo = 'externo' then v_paroq end,
              case when v_tipo = 'externo' then v_paroco end,
              v_token);
    exception when unique_violation then
      raise exception 'O turno % acabou de ser reservado por outro grupo.', v_turno.nome;
    end;
  end loop;

  return v_codigo;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function apagar_conta_sem_pastoral(uuid) from public, anon, authenticated;
revoke execute on function salvar_acesso_pastoral(bigint, text, text) from public, anon;
revoke execute on function remover_acesso_pastoral(bigint) from public, anon;
revoke execute on function minhas_pastorais() from public, anon;
revoke execute on function criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text) from public, anon;
grant execute on function minhas_pastorais() to authenticated;
grant execute on function salvar_acesso_pastoral(bigint, text, text) to authenticated;
grant execute on function remover_acesso_pastoral(bigint) to authenticated;
grant execute on function criar_reserva(bigint, date, text[], text, text, text, text, text, text, text, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-barracas.sql

-- =====================================================================
-- atualizacao-barracas.sql — Agendamento de barracas (pastorais)
-- Rode no SQL Editor do Supabase depois de atualizacao-incrementos.sql.
-- Pode ser executado de novo sem perder dados.
--
-- Tudo aqui é NOVO e separado das salas: tabelas, funções e regras próprias.
-- Nada das reservas de salas, do Direcionamento ou das pastorais é alterado.
--
--   • Sábados e domingos, turnos Manhã (M), Tarde (V) e Noite (N).
--   • Uma barraca por turno. Pedido pendente já bloqueia o turno.
--   • Só pastorais conectadas pedem; a secretaria aprova em até 48 h
--     (prazo_aprovacao_horas). Sem resposta, o pedido expira.
--   • Código do comprovante: BR-AAAA-NNNN.
--   • A secretaria bloqueia finais de semana (ou só o sábado / o domingo).
-- =====================================================================

create sequence if not exists barraca_seq;

-- ---------------------------------------------------------------------
-- Pedidos de barraca: uma linha por turno (o código agrupa o pedido)
-- ---------------------------------------------------------------------
create table if not exists barracas_reservas (
  id                    bigint generated always as identity primary key,
  codigo                text not null,
  data                  date not null check (extract(dow from data)::int in (0, 6)),
  turno                 text not null check (turno in ('M','V','N')),
  grupo                 text not null,
  responsavel_nome      text not null,
  responsavel_telefone  text not null,
  solicitante_id        uuid references auth.users(id) on delete set null,
  mensagem              text,
  status                text not null check (status in ('pendente','confirmada','recusada','cancelada','expirada','realizada')),
  motivo_recusa         text,
  aprovado_por          uuid references auth.users(id) on delete set null,
  aprovado_em           timestamptz,
  criado_em             timestamptz not null default now()
);

create index if not exists barracas_codigo_idx on barracas_reservas (codigo);
create index if not exists barracas_data_idx   on barracas_reservas (data);
create index if not exists barracas_solic_idx  on barracas_reservas (solicitante_id);

-- Uma barraca por turno: pendente, confirmada ou realizada ocupam o turno
create unique index if not exists barracas_turno_unico
  on barracas_reservas (data, turno)
  where status in ('pendente','confirmada','realizada');

-- ---------------------------------------------------------------------
-- Bloqueios de barracas (finais de semana inteiros, ou só sábado / domingo)
-- ---------------------------------------------------------------------
create table if not exists barracas_bloqueios (
  id           bigint generated always as identity primary key,
  data_inicio  date not null,
  data_fim     date not null,
  motivo       text not null,
  criado_por   uuid references auth.users(id) on delete set null,
  criado_em    timestamptz not null default now(),
  check (data_fim >= data_inicio)
);

create index if not exists barracas_bloq_idx on barracas_bloqueios (data_inicio, data_fim);

-- ---------------------------------------------------------------------
-- Agenda pública (sem dados pessoais): só o nome da pastoral
-- ---------------------------------------------------------------------
create or replace view barracas_agenda_publica as
select b.data, b.turno, b.status, b.grupo
  from barracas_reservas b
 where b.status in ('pendente','confirmada','realizada');

-- ---------------------------------------------------------------------
-- Pedidos sem resposta no prazo expiram e liberam o turno.
-- Pedido pendente de um dia que já passou também expira.
-- ---------------------------------------------------------------------
create or replace function expirar_barracas()
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update barracas_reservas
     set status = 'expirada'
   where status = 'pendente'
     and (criado_em < now() - make_interval(hours => coalesce(cfg('prazo_aprovacao_horas'), '48')::int)
          or data < hoje_sp());
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Pedir barraca. p_turnos: lista 'AAAA-MM-DD:T' (ex.: '2026-11-14:M').
-- Pastoral: pedido pendente, em nome de uma das pastorais do login.
-- Secretaria: confirmado na hora, em nome da pastoral informada.
-- Retorna o código do comprovante (BR-AAAA-NNNN).
-- ---------------------------------------------------------------------
drop function if exists solicitar_barraca(text[], text, text, text, text);

create function solicitar_barraca(
  p_turnos    text[],
  p_grupo     text,
  p_nome      text,
  p_telefone  text,
  p_mensagem  text default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_admin    boolean := is_admin();
  v_hoje     date := hoje_sp();
  v_item     text;
  v_data     date;
  v_turno    text;
  v_status   text;
  v_codigo   text;
  v_pastoral text;
  v_nome     text := trim(coalesce(p_nome, ''));
  v_fone     text := trim(coalesce(p_telefone, ''));
  v_grupo    text := regexp_replace(trim(coalesce(p_grupo, '')), '\s+', ' ', 'g');
  v_msg      text := nullif(left(trim(coalesce(p_mensagem, '')), 500), '');
  v_nomes    text[] := array['M','V','N'];
  v_rotulo   text;
begin
  if v_uid is null then
    raise exception 'Entre com o login da sua pastoral, grupo ou movimento para reservar a barraca.';
  end if;
  if not sessao_valida() then
    raise exception 'Sua sessão terminou (a senha foi alterada). Entre novamente.';
  end if;

  if v_admin then
    -- Secretaria: a pastoral precisa estar no cadastro
    select nome into v_pastoral from pastorais where nome_comparavel(nome) = nome_comparavel(v_grupo) limit 1;
    if v_pastoral is null then
      raise exception 'Escolha a pastoral, movimento ou grupo na lista.';
    end if;
  else
    if not exists (select 1 from pastorais where user_id = v_uid) then
      raise exception 'Só as pastorais, movimentos e grupos da paróquia podem reservar barracas.';
    end if;
    select nome into v_pastoral from pastorais
     where user_id = v_uid and nome_comparavel(nome) = nome_comparavel(v_grupo) limit 1;
    if v_pastoral is null then
      if (select count(*) from pastorais where user_id = v_uid) = 1 then
        select nome into v_pastoral from pastorais where user_id = v_uid;
      else
        raise exception 'Escolha em nome de qual pastoral, movimento ou grupo é a reserva.';
      end if;
    end if;
  end if;
  v_grupo := v_pastoral;

  if v_nome = '' then
    raise exception 'Informe o nome do responsável.';
  end if;
  if length(so_digitos(v_fone)) < 10 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  if p_turnos is null or array_length(p_turnos, 1) is null then
    raise exception 'Escolha pelo menos um turno.';
  end if;

  perform expirar_barracas();

  -- Guarda nome e telefone para preencher o formulário da próxima vez (não muda o grupo das salas)
  if not v_admin then
    insert into solicitantes (id, nome, telefone, email, grupo)
    values (v_uid, v_nome, v_fone, coalesce((select email from auth.users where id = v_uid), ''), v_grupo)
    on conflict (id) do update set nome = excluded.nome, telefone = excluded.telefone;
  end if;

  v_status := case when v_admin then 'confirmada' else 'pendente' end;

  foreach v_item in array p_turnos loop
    begin
      v_data  := split_part(v_item, ':', 1)::date;
      v_turno := upper(split_part(v_item, ':', 2));
    exception when others then
      raise exception 'Turno inválido: %.', v_item;
    end;
    if not (v_turno = any (v_nomes)) then
      raise exception 'Turno inválido: %.', v_item;
    end if;
    v_rotulo := case v_turno when 'M' then 'manhã' when 'V' then 'tarde' else 'noite' end
                || ' de ' || to_char(v_data, 'DD/MM/YYYY');

    if extract(dow from v_data)::int not in (0, 6) then
      raise exception 'Barracas só aos sábados e domingos (% não é fim de semana).', to_char(v_data, 'DD/MM/YYYY');
    end if;
    if v_data < v_hoje then
      raise exception 'A data % já passou.', to_char(v_data, 'DD/MM/YYYY');
    end if;
    if not v_admin and extract(year from v_data) <> extract(year from v_hoje) then
      raise exception 'A agenda de barracas está aberta só para o ano de %.', extract(year from v_hoje);
    end if;
    if exists (select 1 from barracas_bloqueios b where v_data between b.data_inicio and b.data_fim) then
      raise exception 'O dia % está bloqueado pela secretaria.', to_char(v_data, 'DD/MM/YYYY');
    end if;

    if v_codigo is null then
      v_codigo := 'BR-' || to_char(v_hoje, 'YYYY') || '-' || lpad(nextval('barraca_seq')::text, 4, '0');
    end if;

    begin
      insert into barracas_reservas (codigo, data, turno, grupo, responsavel_nome, responsavel_telefone,
                                     solicitante_id, mensagem, status, aprovado_por, aprovado_em)
      values (v_codigo, v_data, v_turno, v_grupo, v_nome, v_fone, v_uid, v_msg, v_status,
              case when v_admin then v_uid end, case when v_admin then now() end);
    exception when unique_violation then
      raise exception 'A barraca da % acabou de ser reservada por outra pastoral (ou foi marcada duas vezes).', v_rotulo;
    end;
  end loop;

  return v_codigo;
end;
$$;

-- ---------------------------------------------------------------------
-- Comprovante pelo código BR-…  A mensagem para a secretaria só aparece
-- para a própria pastoral e para a secretaria.
-- ---------------------------------------------------------------------
drop function if exists obter_comprovante_barraca(text);

create function obter_comprovante_barraca(p_codigo text)
returns table (
  codigo        text,
  data          date,
  turno         text,
  grupo         text,
  responsavel   text,
  mensagem      text,
  status        text,
  motivo_recusa text,
  dono          boolean
)
language sql stable security definer set search_path = public
as $$
  select b.codigo,
         b.data,
         b.turno,
         b.grupo,
         split_part(trim(b.responsavel_nome), ' ', 1) ||
           case when position(' ' in trim(b.responsavel_nome)) > 0
                then ' ' || left((string_to_array(trim(b.responsavel_nome), ' '))[array_length(string_to_array(trim(b.responsavel_nome), ' '), 1)], 1) || '.'
                else '' end,
         case when b.solicitante_id = auth.uid() or is_admin() then b.mensagem end,
         b.status,
         b.motivo_recusa,
         (auth.uid() is not null and b.solicitante_id = auth.uid())
    from barracas_reservas b
   where b.codigo = upper(trim(p_codigo))
   order by b.data, case b.turno when 'M' then 1 when 'V' then 2 else 3 end;
$$;

-- ---------------------------------------------------------------------
-- Secretaria aprova ou recusa (todo o pedido de uma vez)
-- ---------------------------------------------------------------------
drop function if exists decidir_barraca(text, boolean, text);

create function decidir_barraca(p_codigo text, p_aprovar boolean, p_motivo text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_qtd int;
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode aprovar ou recusar.';
  end if;
  perform expirar_barracas();
  if not p_aprovar and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo da recusa.';
  end if;
  update barracas_reservas
     set status        = case when p_aprovar then 'confirmada' else 'recusada' end,
         motivo_recusa = case when p_aprovar then null else trim(p_motivo) end,
         aprovado_por  = auth.uid(),
         aprovado_em   = now()
   where codigo = v_cod and status = 'pendente';
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then
    raise exception 'Este pedido não está mais aguardando aprovação (pode ter expirado ou sido cancelado).';
  end if;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------
-- A pastoral cancela o próprio pedido (pendente ou confirmado, até o dia)
-- ---------------------------------------------------------------------
drop function if exists cancelar_minha_barraca(text);

create function cancelar_minha_barraca(p_codigo text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_qtd int;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  if not exists (select 1 from barracas_reservas where codigo = v_cod and (solicitante_id = auth.uid() or is_admin())) then
    raise exception 'Reserva não encontrada.';
  end if;
  update barracas_reservas
     set status = 'cancelada'
   where codigo = v_cod
     and (solicitante_id = auth.uid() or is_admin())
     and status in ('pendente','confirmada')
     and data >= hoje_sp();
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then
    raise exception 'Esta reserva não pode mais ser cancelada (já passou ou já foi cancelada).';
  end if;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------
-- Regras de acesso (RLS)
-- ---------------------------------------------------------------------
alter table barracas_reservas  enable row level security;
alter table barracas_bloqueios enable row level security;

-- Pedidos: a pastoral lê os próprios; a secretaria lê e altera tudo.
-- Ninguém insere direto: só pela função solicitar_barraca().
drop policy if exists barr_ler on barracas_reservas;
create policy barr_ler on barracas_reservas for select using (solicitante_id = auth.uid() or is_admin());
drop policy if exists barr_admin on barracas_reservas;
create policy barr_admin on barracas_reservas for all using (is_admin()) with check (is_admin());

-- Bloqueios: todos leem; só a secretaria altera
drop policy if exists barr_bloq_ler on barracas_bloqueios;
create policy barr_bloq_ler on barracas_bloqueios for select using (true);
drop policy if exists barr_bloq_admin on barracas_bloqueios;
create policy barr_bloq_admin on barracas_bloqueios for all using (is_admin()) with check (is_admin());

grant select on barracas_agenda_publica to anon, authenticated;
grant select on barracas_bloqueios to anon, authenticated;
grant select, insert, update, delete on barracas_reservas, barracas_bloqueios to authenticated;

revoke execute on function expirar_barracas() from public;
revoke execute on function solicitar_barraca(text[], text, text, text, text) from public;
revoke execute on function obter_comprovante_barraca(text) from public;
revoke execute on function decidir_barraca(text, boolean, text) from public;
revoke execute on function cancelar_minha_barraca(text) from public;
revoke execute on function solicitar_barraca(text[], text, text, text, text) from anon;
revoke execute on function decidir_barraca(text, boolean, text) from anon;
revoke execute on function cancelar_minha_barraca(text) from anon;

grant execute on function expirar_barracas() to anon, authenticated;
grant execute on function obter_comprovante_barraca(text) to anon, authenticated;
grant execute on function solicitar_barraca(text[], text, text, text, text) to authenticated;
grant execute on function decidir_barraca(text, boolean, text) to authenticated;
grant execute on function cancelar_minha_barraca(text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-expiracao.sql

-- =====================================================================
-- atualizacao-expiracao.sql — Expiração automática a cada 15 minutos
-- Rode no SQL Editor do Supabase depois de atualizacao-barracas.sql.
-- Pode ser executado de novo: o agendamento é refeito, sem duplicar.
--
-- Liga a extensão pg_cron (o "despertador" do banco) e agenda a
-- expiração dos pedidos sem resposta no prazo (48 h), sem depender de
-- alguém abrir o site:
--   • expirar_pendentes()  — pedidos de salas (função que já existia);
--   • expirar_barracas()   — pedidos de barracas (se já estiver instalada).
-- As chamadas que o site já faz continuam iguais.
--
-- Para ver o agendamento:   select * from cron.job;
-- Para ver as execuções:    select * from cron.job_run_details order by start_time desc limit 20;
-- Para desligar:            select cron.unschedule('expirar-pendentes');
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $do$
declare
  v_cmd text := 'select public.expirar_pendentes();';
begin
  -- Barracas: entra no mesmo agendamento quando a função existir
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'expirar_barracas') then
    v_cmd := v_cmd || ' select public.expirar_barracas();';
  end if;

  -- Refaz o agendamento (sem criar um segundo)
  perform cron.unschedule(jobid) from cron.job where jobname = 'expirar-pendentes';
  perform cron.schedule('expirar-pendentes', '*/15 * * * *', v_cmd);
end;
$do$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> atualizacao-agenda.sql

-- =====================================================================
-- atualizacao-agenda.sql — Agenda da secretaria e aviso diário (acólito)
-- Rode no SQL Editor do Supabase depois de atualizacao-expiracao.sql.
-- Pode ser executado de novo sem perder dados.
--
--   • agenda_eventos: compromissos da secretaria e dias bloqueados
--     (feriados, dias sem expediente). Só a secretaria lê e altera.
--     O bloqueio da Agenda é só um registro: NÃO impede reservas.
--   • agenda_aviso: último dia em que o aviso do acólito foi mostrado
--     para cada conta (uma vez por dia, em qualquer aparelho).
-- As reservas de salas, barracas e Direcionamento aparecem na Agenda
-- lendo as tabelas que já existem; nada nelas é alterado.
-- =====================================================================

create table if not exists agenda_eventos (
  id            bigint generated always as identity primary key,
  tipo          text not null default 'compromisso' check (tipo in ('compromisso','bloqueio')),
  data          date not null,
  data_fim      date,                       -- bloqueio de vários dias (até esta data)
  dia_inteiro   boolean not null default false,
  hora_inicio   time,
  hora_fim      time,
  titulo        text not null check (length(trim(titulo)) > 0),
  resumo        text,
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,
  check (data_fim is null or data_fim >= data),
  check (dia_inteiro or hora_inicio is not null),
  check (hora_fim is null or hora_inicio is null or hora_fim > hora_inicio)
);

create index if not exists agenda_eventos_data_idx on agenda_eventos (data);

create table if not exists agenda_aviso (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  ultimo_dia  date not null
);

-- ---------------------------------------------------------------------
-- Aviso diário: devolve true só na primeira chamada do dia (por conta)
-- e já registra o dia. Duas abas abertas ao mesmo tempo não mostram duas vezes.
-- ---------------------------------------------------------------------
create or replace function marcar_aviso_agenda()
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_hoje date := hoje_sp();
  v_ok   boolean;
begin
  if auth.uid() is null or not is_admin() then
    return false;
  end if;
  insert into agenda_aviso (user_id, ultimo_dia)
  values (auth.uid(), v_hoje)
  on conflict (user_id) do update set ultimo_dia = excluded.ultimo_dia
   where agenda_aviso.ultimo_dia < excluded.ultimo_dia
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- ---------------------------------------------------------------------
-- Regras de acesso: só a secretaria
-- ---------------------------------------------------------------------
alter table agenda_eventos enable row level security;
alter table agenda_aviso   enable row level security;

drop policy if exists agenda_admin on agenda_eventos;
create policy agenda_admin on agenda_eventos for all using (is_admin()) with check (is_admin());

drop policy if exists agenda_aviso_proprio on agenda_aviso;
create policy agenda_aviso_proprio on agenda_aviso for all
  using (user_id = auth.uid() and is_admin()) with check (user_id = auth.uid() and is_admin());

grant select, insert, update, delete on agenda_eventos, agenda_aviso to authenticated;

revoke execute on function marcar_aviso_agenda() from public;
revoke execute on function marcar_aviso_agenda() from anon;
grant execute on function marcar_aviso_agenda() to authenticated;


