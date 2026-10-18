-- =====================================================================
-- atendimentos.sql — Direcionamento Espiritual (agenda do Pároco)
-- Gerida apenas pela secretaria e pelo Pároco (sem acesso público).
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
-- status: agendado | pendente (aguarda secretaria) | realizado | cancelado
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
  status              text not null default 'agendado' check (status in ('agendado','pendente','realizado','cancelado')),
  criado_por          uuid references auth.users(id) on delete set null,
  liberado_por        uuid references auth.users(id) on delete set null,
  liberado_em         timestamptz,
  criado_em           timestamptz not null default now(),
  check (fim > inicio)
);

-- Um horário só tem um atendimento ativo
create unique index if not exists atendimentos_horario_unico
  on atendimentos (data, inicio)
  where status in ('agendado','pendente','realizado');

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
  p_paroco    text
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
    insert into atendimentos (data, inicio, fim, nome, telefone, tipo, assunto, endereco, paroquia_origem,
                              paroco_responsavel, status, criado_por, liberado_por, liberado_em)
    values (p_data, p_inicio, p_fim, v_nome, v_fone, p_tipo, nullif(trim(coalesce(p_assunto, '')), ''), v_end,
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

revoke execute on function agendar_atendimento(date, time, time, text, text, text, text, text, text, text) from public, anon;
revoke execute on function liberar_atendimento(bigint) from public, anon;
grant execute on function is_paroco()    to anon, authenticated;
grant execute on function pode_atender() to anon, authenticated;
grant execute on function agendar_atendimento(date, time, time, text, text, text, text, text, text, text) to authenticated;
grant execute on function liberar_atendimento(bigint) to authenticated;
