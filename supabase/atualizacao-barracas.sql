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
