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
