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
