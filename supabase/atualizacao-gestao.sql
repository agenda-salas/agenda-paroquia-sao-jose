-- =====================================================================
-- atualizacao-gestao.sql — atualiza o banco JÁ INSTALADO para a versão
-- com página de Gestão e grupo em texto livre.
-- Não apaga salas, turnos, configurações nem reservas.
-- Ordem: 1) este arquivo   2) functions.sql   3) policies.sql
-- Pode ser executado mais de uma vez sem problema.
-- =====================================================================

-- A view depende das colunas antigas: sai agora e volta no fim
drop view if exists agenda_publica;

-- ---------------------------------------------------------------------
-- Reservas: grupo em texto e nome/telefone do responsável em cada reserva
-- ---------------------------------------------------------------------
alter table reservas add column if not exists grupo text;
alter table reservas add column if not exists responsavel_nome text;
alter table reservas add column if not exists responsavel_telefone text;

alter table solicitantes add column if not exists grupo text;
alter table recorrencias add column if not exists grupo text;

-- Copia os dados da estrutura antiga (só se ela ainda existir)
do $$
begin
  if to_regclass('public.grupos') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservas' and column_name = 'grupo_id') then
      update reservas r
         set grupo = coalesce((select g.nome from grupos g where g.id = r.grupo_id), r.grupo_outro)
       where r.grupo is null;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitantes' and column_name = 'grupo_id') then
      update solicitantes s
         set grupo = coalesce((select g.nome from grupos g where g.id = s.grupo_id), s.grupo_outro)
       where s.grupo is null;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recorrencias' and column_name = 'grupo_id') then
      update recorrencias r
         set grupo = (select g.nome from grupos g where g.id = r.grupo_id)
       where r.grupo is null;
    end if;
  end if;
end $$;

update reservas r
   set responsavel_nome = coalesce(nullif(r.responsavel_nome, ''), s.nome, ''),
       responsavel_telefone = coalesce(nullif(r.responsavel_telefone, ''), s.telefone, '')
  from solicitantes s
 where s.id = r.solicitante_id
   and (r.responsavel_nome is null or r.responsavel_telefone is null);

update reservas set grupo = '' where grupo is null;
update reservas set responsavel_nome = '' where responsavel_nome is null;
update reservas set responsavel_telefone = '' where responsavel_telefone is null;

alter table reservas alter column grupo set not null;
alter table reservas alter column responsavel_nome set not null;
alter table reservas alter column responsavel_telefone set not null;

-- Colunas e tabela que deixaram de existir
alter table reservas     drop column if exists grupo_id;
alter table reservas     drop column if exists grupo_outro;
alter table solicitantes drop column if exists grupo_id;
alter table solicitantes drop column if exists grupo_outro;
alter table solicitantes drop column if exists canal_preferido;
alter table recorrencias drop column if exists grupo_id;
drop table if exists grupos cascade;

-- Nome e telefone passam a ser informados na reserva
alter table solicitantes alter column nome set default '';
alter table solicitantes alter column telefone set default '';

-- Garante que os próximos códigos de reserva não repitam os já existentes
do $$
declare v_max int;
begin
  select coalesce(max(nullif(regexp_replace(codigo, '^.*-', ''), '')::int), 0) into v_max
    from reservas where codigo ~ '^SJ-[0-9]{4}-[0-9]+$';
  if v_max > 0 then
    perform setval('reserva_seq', greatest(v_max, (select last_value from reserva_seq)));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Agenda pública (sem dados pessoais)
-- ---------------------------------------------------------------------
create or replace view agenda_publica as
select r.sala_id,
       r.data,
       t.codigo  as turno,
       r.status,
       r.grupo
from reservas r
join turnos t on t.id = r.turno_id
where r.status in ('pendente','confirmada','realizada','nao_compareceu');
