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
