-- =====================================================================
-- atualizacao-salas.sql
--   1) Libera o turno da Noite às sextas-feiras.
--   2) Permite à secretaria EXCLUIR uma sala.
--      A sala sai do site e da gestão, mas as reservas antigas continuam
--      no histórico (com o nome da sala). As reservas futuras dela são
--      canceladas, e a secretaria recebe a lista para avisar pelo WhatsApp.
-- Rode no SQL Editor. Pode ser executado de novo sem problema.
-- =====================================================================

-- 1) Noite também às sextas (0 = domingo ... 6 = sábado)
update turnos set dias_semana = '{0,1,2,3,4,5,6}' where codigo = 'N';

-- 2) Exclusão de sala
alter table salas add column if not exists excluida_em timestamptz;

-- O número só precisa ser único entre as salas não excluídas
-- (assim dá para cadastrar de novo uma sala com o número de uma excluída)
alter table salas drop constraint if exists salas_numero_key;
create unique index if not exists salas_numero_unico on salas (numero) where excluida_em is null;

drop function if exists excluir_sala(bigint);
create function excluir_sala(p_id bigint)
returns table (codigo text, data date, turno text, grupo text, responsavel_nome text, responsavel_telefone text)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Somente a secretaria pode excluir salas.';
  end if;
  if not exists (select 1 from salas s where s.id = p_id and s.excluida_em is null) then
    raise exception 'Sala não encontrada.';
  end if;

  update salas set excluida_em = now(), ativa = false where id = p_id;

  return query
  with canceladas as (
    update reservas r
       set status = 'cancelada'
     where r.sala_id = p_id
       and r.data >= (now() at time zone 'America/Sao_Paulo')::date
       and r.status in ('pendente','confirmada')
    returning r.codigo, r.data, r.turno_id, r.grupo, r.responsavel_nome, r.responsavel_telefone
  )
  select c.codigo, c.data, t.nome, c.grupo, c.responsavel_nome, c.responsavel_telefone
    from canceladas c join turnos t on t.id = c.turno_id
   order by c.data, t.ordem;
end;
$$;

revoke execute on function excluir_sala(bigint) from public, anon;
grant execute on function excluir_sala(bigint) to authenticated;
