-- =====================================================================
-- atualizacao-itens.sql — itens de cada sala (cadeiras, mesas, ventiladores...)
-- A secretaria cadastra os itens na aba Salas; eles aparecem no comprovante.
-- Rode no SQL Editor. Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

alter table salas add column if not exists itens jsonb not null default '[]';

-- Comprovante passa a trazer os itens da sala
drop function if exists obter_comprovante(text);
create function obter_comprovante(p_codigo text)
returns table (
  codigo        text,
  sala          text,
  capacidade    int,
  controlada    boolean,
  data          date,
  turno         text,
  turno_codigo  text,
  inicio        time,
  fim           time,
  grupo         text,
  responsavel   text,
  motivo        text,
  status        text,
  motivo_recusa text,
  regras        text,
  tipo          text,
  paroquia_origem text,
  itens         jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.codigo,
         coalesce(s.nome, 'Sala ' || s.numero),
         s.capacidade,
         s.controlada,
         r.data,
         t.nome,
         t.codigo,
         t.inicio,
         t.fim,
         r.grupo,
         split_part(trim(r.responsavel_nome), ' ', 1) ||
           case when position(' ' in trim(r.responsavel_nome)) > 0
                then ' ' || left((string_to_array(trim(r.responsavel_nome), ' '))[array_length(string_to_array(trim(r.responsavel_nome), ' '), 1)], 1) || '.'
                else '' end,
         r.motivo,
         r.status,
         r.motivo_recusa,
         cfg('texto_regras'),
         r.tipo,
         r.paroquia_origem,
         s.itens
    from reservas r
    join salas s   on s.id = r.sala_id
    join turnos t  on t.id = r.turno_id
   where r.codigo = upper(trim(p_codigo))
   order by t.ordem;
$$;

grant execute on function obter_comprovante(text) to anon, authenticated;
