-- =====================================================================
-- atualizacao-expiracao.sql — Expiração automática a cada 15 minutos
-- Rode no SQL Editor do Supabase depois de atualizacao-barracas.sql.
-- Pode ser executado de novo: o agendamento é refeito, sem duplicar.
--
-- Liga a extensão pg_cron (o "despertador" do banco) e agenda a
-- expiração dos pedidos sem resposta no prazo (48 h), sem depender de
-- alguém abrir o site:
--   • expirar_pendentes()  — pedidos de salas (função que já existia);
--   • expirar_barracas()   — pedidos de barracas (se já estiver instalada).
-- As chamadas que o site já faz continuam iguais.
--
-- Para ver o agendamento:   select * from cron.job;
-- Para ver as execuções:    select * from cron.job_run_details order by start_time desc limit 20;
-- Para desligar:            select cron.unschedule('expirar-pendentes');
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $do$
declare
  v_cmd text := 'select public.expirar_pendentes();';
begin
  -- Barracas: entra no mesmo agendamento quando a função existir
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'expirar_barracas') then
    v_cmd := v_cmd || ' select public.expirar_barracas();';
  end if;

  -- Refaz o agendamento (sem criar um segundo)
  perform cron.unschedule(jobid) from cron.job where jobname = 'expirar-pendentes';
  perform cron.schedule('expirar-pendentes', '*/15 * * * *', v_cmd);
end;
$do$;
