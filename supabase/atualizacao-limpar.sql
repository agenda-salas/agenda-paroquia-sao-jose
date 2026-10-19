-- =====================================================================
-- atualizacao-limpar.sql — botão "Limpar canceladas e recusadas"
-- Tira essas reservas da lista "Minhas reservas" da própria pessoa.
-- Nada é apagado: a secretaria continua vendo tudo na Área de Gestão.
-- Rode no SQL Editor. Pode ser executado de novo sem problema.
-- =====================================================================

alter table reservas add column if not exists oculta_solicitante boolean not null default false;

drop function if exists limpar_minhas_reservas();
create function limpar_minhas_reservas()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_qtd int;
begin
  if auth.uid() is null then
    raise exception 'Entre com seu e-mail e senha.';
  end if;
  update reservas
     set oculta_solicitante = true
   where solicitante_id = auth.uid()
     and status in ('cancelada','recusada')
     and not oculta_solicitante;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke execute on function limpar_minhas_reservas() from public, anon;
grant execute on function limpar_minhas_reservas() to authenticated;
