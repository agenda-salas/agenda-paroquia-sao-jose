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
