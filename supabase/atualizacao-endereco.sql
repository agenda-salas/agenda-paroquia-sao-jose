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
