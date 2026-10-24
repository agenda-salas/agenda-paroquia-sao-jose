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
