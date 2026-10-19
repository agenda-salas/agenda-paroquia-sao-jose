-- =====================================================================
-- atualizacao-minhas-atendimentos.sql
-- Os pedidos de Direcionamento Espiritual passam a aparecer em "Minhas reservas".
-- O botão "Limpar canceladas e recusadas" também limpa os atendimentos cancelados.
-- Rode no SQL Editor depois de atendimentos.sql e atualizacao-limpar.sql.
-- Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

alter table atendimentos add column if not exists oculto_solicitante boolean not null default false;

-- Pedidos da própria pessoa (não mostra os que a secretaria ou o Pároco marcaram para outros)
create or replace function meus_atendimentos()
returns table (id bigint, data date, inicio time, fim time, tipo text, status text)
language sql stable security definer set search_path = public
as $$
  select a.id, a.data, a.inicio, a.fim, a.tipo, a.status
    from atendimentos a
   where a.criado_por = auth.uid()
     and not a.oculto_solicitante
     and not pode_atender()
     and a.data >= (now() at time zone 'America/Sao_Paulo')::date - 30
   order by a.data desc, a.inicio desc
   limit 20;
$$;

-- "Limpar canceladas e recusadas": reservas de sala e atendimentos
create or replace function limpar_minhas_reservas()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_res int; v_at int;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  update reservas
     set oculta_solicitante = true
   where solicitante_id = auth.uid()
     and status in ('cancelada','recusada')
     and not oculta_solicitante;
  get diagnostics v_res = row_count;
  update atendimentos
     set oculto_solicitante = true
   where criado_por = auth.uid()
     and status = 'cancelado'
     and not oculto_solicitante;
  get diagnostics v_at = row_count;
  return v_res + v_at;
end;
$$;

revoke execute on function meus_atendimentos() from public, anon;
revoke execute on function limpar_minhas_reservas() from public, anon;
grant execute on function meus_atendimentos() to authenticated;
grant execute on function limpar_minhas_reservas() to authenticated;
