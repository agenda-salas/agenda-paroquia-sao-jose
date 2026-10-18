-- =====================================================================
-- atualizacao-senha.sql — a secretaria define uma nova senha para um
-- coordenador pela página de Gestão. Rode uma vez no SQL Editor.
-- Pode ser executado de novo sem problema.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

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
end;
$$;

revoke execute on function definir_senha(uuid, text) from public, anon;
grant execute on function definir_senha(uuid, text) to authenticated;
