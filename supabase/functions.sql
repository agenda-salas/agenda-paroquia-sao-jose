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
  paroquia_origem text
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
         r.paroquia_origem
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
