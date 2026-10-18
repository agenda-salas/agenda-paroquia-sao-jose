-- =====================================================================
-- policies.sql — regras de acesso (Row Level Security)
-- Execute por último.
--   Público (sem login): lê salas, turnos, bloqueios e a agenda.
--   Solicitante: lê e atualiza o próprio cadastro; lê as próprias reservas.
--                Reserva somente pela função criar_reserva().
--   Secretaria: lê e altera tudo.
-- =====================================================================

alter table configuracoes   enable row level security;
alter table salas           enable row level security;
alter table administradores enable row level security;
alter table solicitantes    enable row level security;
alter table turnos          enable row level security;
alter table recorrencias    enable row level security;
alter table reservas        enable row level security;
alter table bloqueios       enable row level security;

-- Configurações
drop policy if exists cfg_ler on configuracoes;
create policy cfg_ler on configuracoes for select using (true);
drop policy if exists cfg_admin on configuracoes;
create policy cfg_admin on configuracoes for all using (is_admin()) with check (is_admin());

-- Salas
drop policy if exists salas_ler on salas;
create policy salas_ler on salas for select using (ativa or is_admin());
drop policy if exists salas_admin on salas;
create policy salas_admin on salas for all using (is_admin()) with check (is_admin());

-- Administradores: cada um vê a própria linha; inclusão só pelo SQL Editor
drop policy if exists adm_ler on administradores;
create policy adm_ler on administradores for select using (user_id = auth.uid());

-- Solicitantes
drop policy if exists solic_ler on solicitantes;
create policy solic_ler on solicitantes for select using (id = auth.uid() or is_admin());
drop policy if exists solic_inserir on solicitantes;
create policy solic_inserir on solicitantes for insert with check (id = auth.uid());
drop policy if exists solic_alterar on solicitantes;
create policy solic_alterar on solicitantes for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists solic_admin on solicitantes;
create policy solic_admin on solicitantes for all using (is_admin()) with check (is_admin());

-- Turnos
drop policy if exists turnos_ler on turnos;
create policy turnos_ler on turnos for select using (true);
drop policy if exists turnos_admin on turnos;
create policy turnos_admin on turnos for all using (is_admin()) with check (is_admin());

-- Recorrências
drop policy if exists rec_admin on recorrencias;
create policy rec_admin on recorrencias for all using (is_admin()) with check (is_admin());

-- Reservas: sem insert direto (só pela função criar_reserva)
drop policy if exists res_ler on reservas;
create policy res_ler on reservas for select using (solicitante_id = auth.uid() or is_admin());
drop policy if exists res_admin on reservas;
create policy res_admin on reservas for all using (is_admin()) with check (is_admin());

-- Bloqueios
drop policy if exists bloq_ler on bloqueios;
create policy bloq_ler on bloqueios for select using (true);
drop policy if exists bloq_admin on bloqueios;
create policy bloq_admin on bloqueios for all using (is_admin()) with check (is_admin());

-- Agenda pública (view sem dados pessoais)
grant select on agenda_publica to anon, authenticated;

-- Acesso às tabelas (as regras acima decidem quais linhas cada um vê)
grant select on configuracoes, salas, turnos, bloqueios to anon, authenticated;
grant select, insert, update on solicitantes to authenticated;
grant select, insert, update, delete on configuracoes, salas, turnos, bloqueios, reservas, recorrencias to authenticated;
grant select on administradores to authenticated;
