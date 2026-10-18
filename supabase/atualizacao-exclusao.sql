-- =====================================================================
-- atualizacao-exclusao.sql — permite à secretaria excluir reservas e
-- coordenadores pela página de Gestão. Rode uma vez no SQL Editor.
-- Pode ser executado de novo sem problema.
-- =====================================================================

-- Reservas continuam no histórico quando o coordenador é excluído
alter table reservas alter column solicitante_id drop not null;
alter table reservas drop constraint if exists reservas_solicitante_id_fkey;
alter table reservas add constraint reservas_solicitante_id_fkey
  foreign key (solicitante_id) references solicitantes(id) on delete set null;

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

revoke execute on function excluir_coordenador(uuid) from public, anon;
grant execute on function excluir_coordenador(uuid) to authenticated;
