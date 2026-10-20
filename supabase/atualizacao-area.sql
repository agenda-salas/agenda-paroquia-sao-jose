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
