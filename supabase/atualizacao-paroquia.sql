-- =====================================================================
-- atualizacao-paroquia.sql — reservas de paroquianos e de outras paróquias
-- Rode no SQL Editor, nesta ordem:
--   1) este arquivo   2) functions.sql   3) atendimentos.sql
-- Pode ser executado de novo sem problema. Não apaga dados.
-- =====================================================================

alter table reservas add column if not exists tipo text not null default 'paroquiano';
alter table reservas add column if not exists endereco text;
alter table reservas add column if not exists paroquia_origem text;
alter table reservas add column if not exists paroco_responsavel text;

alter table reservas drop constraint if exists reservas_tipo_check;
alter table reservas add constraint reservas_tipo_check check (tipo in ('paroquiano','externo'));
