-- =====================================================================
-- pastorais.sql — cadastro de Pastorais, Movimentos e Grupos
-- (aba "Pastorais e Movimentos" da Área de Gestão)
-- Rode no SQL Editor depois de functions.sql. Pode ser executado de novo:
-- os dados iniciais só entram se a tabela estiver vazia.
-- =====================================================================

create table if not exists pastorais (
  id             bigint generated always as identity primary key,
  numero         int,
  nome           text not null check (length(trim(nome)) > 0),
  coordenadores  jsonb not null default '[]'::jsonb,   -- [{nome, telefone, email}]
  reunioes       jsonb not null default '[]'::jsonb,   -- [{dia, local, horario, observacao}]
  observacao     text,
  atualizado_em  timestamptz not null default now()
);

-- Data da última alteração da lista (inclusões, alterações e exclusões)
create or replace function pastorais_alterada()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  insert into configuracoes (chave, valor, descricao)
       values ('pastorais_atualizadas_em', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'Última alteração do cadastro de pastorais')
  on conflict (chave) do update set valor = excluded.valor;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_pastorais_alterada on pastorais;
create trigger trg_pastorais_alterada
  before insert or update or delete on pastorais
  for each row execute function pastorais_alterada();

-- Somente a secretaria vê e altera (telefones e e-mails são dados pessoais)
alter table pastorais enable row level security;
drop policy if exists pastorais_admin on pastorais;
create policy pastorais_admin on pastorais for all using (is_admin()) with check (is_admin());
revoke all on pastorais from anon;
grant select, insert, update, delete on pastorais to authenticated;

-- Lista pública só com os NOMES, para o campo "Pastoral ou grupo" das reservas
drop function if exists nomes_pastorais();
create function nomes_pastorais()
returns setof text
language sql stable security definer set search_path = public
as $$
  select nome from pastorais order by nome;
$$;
grant execute on function nomes_pastorais() to anon, authenticated;

-- Dados iniciais (lista do Conselho Paroquial de Pastoral, atualizada em 20/01/2026)
insert into pastorais (numero, nome, coordenadores, reunioes, observacao)
select * from (values
  (1, 'Acolhida', '[{"nome": "Abmael", "telefone": "(61) 98175-5106", "email": "abmmael@hotmail.com"}, {"nome": "Danielle", "telefone": "(61) 98162-0659", "email": "danicassia180297@gmail.com"}]'::jsonb, '[{"dia": "2º sábado", "local": "Centro Catequético", "horario": "15h", "observacao": ""}]'::jsonb, null),
  (2, 'Apostolado', '[{"nome": "Marta", "telefone": "(61) 99970-2823", "email": "mnorbelia@gmail.com"}, {"nome": "Jaqueline Barbosa", "telefone": "(61) 99965-0717", "email": ""}]'::jsonb, '[{"dia": "1ª sexta-feira", "local": "Capela", "horario": "17h30", "observacao": ""}, {"dia": "Último sábado", "local": "Sala 07", "horario": "15h", "observacao": ""}]'::jsonb, null),
  (3, 'Batismo', '[{"nome": "Jacira", "telefone": "(61) 98471-4929", "email": "jacirapsantos@gmail.com"}, {"nome": "Vanderli", "telefone": "(61) 98472-4521", "email": "cesario.27@hotmail.com"}]'::jsonb, '[{"dia": "1ª quinta-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (4, 'Catequese', '[{"nome": "Nelma Eleoterio", "telefone": "(61) 99972-9573", "email": "nelmacastrodf@yahoo.com.br"}, {"nome": "Rafael Almeida", "telefone": "(61) 98413-5835", "email": "rafaelalmeida96@gmail.com"}]'::jsonb, '[{"dia": "Quando necessário", "local": "", "horario": "", "observacao": ""}]'::jsonb, null),
  (5, 'Cerimoniários', '[{"nome": "Pedro Henrique", "telefone": "(61) 98632-5266", "email": "pedrohenrique.eb.mil@gmail.com"}, {"nome": "Paulo José", "telefone": "(61) 98606-4545", "email": "paulo.jmodesto75@gmail.com"}]'::jsonb, '[{"dia": "Último sábado", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (6, 'Comunicação - PASCOM', '[{"nome": "Lidieth Bettina R. Sanches", "telefone": "(61) 99246-7161", "email": "sanchezlidieth93@gmail.com"}, {"nome": "João Paulo", "telefone": "(61) 99212-9996", "email": "santiagojp@gmail.com"}]'::jsonb, '[{"dia": "Dia 20", "local": "Igreja", "horario": "19h", "observacao": ""}]'::jsonb, null),
  (7, 'Coroinhas', '[{"nome": "Dalise Keila de S. Correa", "telefone": "(61) 98270-1570", "email": "0909.keila@gmail.com"}, {"nome": "Regina Resende", "telefone": "(61) 98603-8335", "email": "contatorlwp@gmail.com"}]'::jsonb, '[{"dia": "Última segunda-feira", "local": "Sala 108", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (8, 'Cursilho - MCC/GED', '[{"nome": "Jerolino Pereira", "telefone": "(61) 99105-9671", "email": "jerolino.pereira@gmail.com"}, {"nome": "Flávio", "telefone": "(61) 99260-8989", "email": "flaviodsa@gmail.com"}]'::jsonb, '[{"dia": "1ª segunda-feira", "local": "Sala 07", "horario": "20h", "observacao": ""}, {"dia": "Quarta-feira", "local": "", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (9, 'Dízimo', '[{"nome": "Jorge", "telefone": "(61) 99987-1990", "email": "pdizimosaojose@gmail.com"}]'::jsonb, '[{"dia": "Último sábado", "local": "Sala do dízimo", "horario": "09h", "observacao": ""}]'::jsonb, null),
  (10, 'ECC', '[{"nome": "Cláudio Nobre", "telefone": "(61) 98126-4710", "email": "juniornobre@gmail.com"}, {"nome": "Rozana Raulino", "telefone": "(61) 99977-8309", "email": "rozanaraulino@gmail.com"}]'::jsonb, '[{"dia": "Quarta-feira", "local": "Casa dos membros", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (11, 'Escola da Fé', '[{"nome": "Cleide Maria de Sanctis", "telefone": "(61) 99253-8583", "email": "cleidesanctis@gmail.com"}]'::jsonb, '[{"dia": "Quarta-feira", "local": "Sala 107", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (12, 'Eventos', '[{"nome": "Francisco", "telefone": "(61) 98466-9684", "email": "francisco.nina.cabral@gmail.com"}, {"nome": "Rodrigo", "telefone": "(61) 98546-4510", "email": ""}]'::jsonb, '[{"dia": "Quando necessário", "local": "", "horario": "", "observacao": ""}]'::jsonb, null),
  (13, 'Familiar', '[{"nome": "Divino", "telefone": "(61) 98206-9088", "email": "pastoralfamiliarpsjtag@gmail.com"}, {"nome": "Sueli", "telefone": "", "email": ""}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala 07", "horario": "19h45", "observacao": ""}]'::jsonb, null),
  (14, 'FUC', '[{"nome": "Eduardo", "telefone": "(61) 98346-9819", "email": "eduardodev18@gmail.com"}, {"nome": "Vinicius", "telefone": "(61) 98199-5046", "email": "viniciusrangel1802@gmail.com"}]'::jsonb, '[{"dia": "Sábado", "local": "Sala superior", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (15, 'JAUC', '[{"nome": "Vitoria", "telefone": "(61) 99361-6521", "email": "vitoria.cristina2002@gmail.com"}, {"nome": "Felipe Gontijo", "telefone": "(61) 99915-3803", "email": "felipegontijotrigueiro@gmail.com"}]'::jsonb, '[{"dia": "Domingo", "local": "Centro Catequético", "horario": "18h30", "observacao": ""}]'::jsonb, null),
  (16, 'Legião de Maria', '[{"nome": "Terezinha", "telefone": "(61) 99988-3738", "email": "maedobomconselho@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala 08", "horario": "8h30", "observacao": ""}]'::jsonb, null),
  (17, 'Liturgia', '[{"nome": "Lindomar Borges", "telefone": "(61) 99808-2057", "email": "lindomar.catolico@gmail.com"}]'::jsonb, '[{"dia": "Terça-feira", "local": "Sala da Liturgia", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (18, 'Mãe Peregrina', '[{"nome": "Patrícia Ferreira", "telefone": "(61) 98623-8459", "email": "fpatriciaferreira43@gmail.com"}, {"nome": "Aparecida Martins", "telefone": "(61) 98468-8037", "email": ""}]'::jsonb, '[{"dia": "2º sábado", "local": "Centro Catequético", "horario": "15h", "observacao": ""}, {"dia": "Dia 18", "local": "Igreja", "horario": "19h", "observacao": "Missa"}]'::jsonb, null),
  (19, 'Mães que Oram pelos Filhos', '[{"nome": "Mary Caixeta Marinho", "telefone": "(61) 98114-8484", "email": "marycmarinho@gmail.com"}]'::jsonb, '[{"dia": "Quinta-feira", "local": "Sala 07", "horario": "17h45", "observacao": ""}]'::jsonb, null),
  (20, 'MESCE', '[{"nome": "Cícero Adriano", "telefone": "(61) 98136-5279", "email": "ciceroadrianobr@gmail.com"}, {"nome": "Dora Garcia", "telefone": "", "email": ""}]'::jsonb, '[{"dia": "3ª segunda-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (21, 'Oficinas de Oração e Vida', '[{"nome": "Kátia Severo", "telefone": "(61) 98513-9194", "email": "katiasevero@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Centro Catequético", "horario": "19h30", "observacao": ""}]'::jsonb, null),
  (22, 'Pastoral de Quadras', '[{"nome": "Lindomar Borges", "telefone": "(61) 99808-2057", "email": "lindomar.catolico@gmail.com"}]'::jsonb, '[{"dia": "Última sexta-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (23, 'Pessoa Idosa - PPI', '[{"nome": "Lindaura Carolina", "telefone": "(61) 99187-9329 / (61) 3963-3470", "email": "lindauracarolina59@gmail.com"}]'::jsonb, '[{"dia": "Quando necessário", "local": "", "horario": "", "observacao": ""}]'::jsonb, null),
  (24, 'RCC', '[{"nome": "Danielle Alves", "telefone": "(61) 99163-2885", "email": "danidaniellealves@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala 02", "horario": "", "observacao": ""}, {"dia": "Terça-feira", "local": "Igreja", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (25, 'Saúde', '[{"nome": "Conceição", "telefone": "(61) 98141-5669", "email": "conceicao1706@hotmail.com"}]'::jsonb, '[{"dia": "2ª quinta-feira", "local": "", "horario": "19h", "observacao": "Reunião"}, {"dia": "Quarta-feira", "local": "HRT", "horario": "", "observacao": "Visitas"}]'::jsonb, null),
  (26, 'Vocacional', '[{"nome": "Marcos", "telefone": "(61) 99260-8962", "email": "marcos@tarcianaaraujo.com.br"}, {"nome": "Tarciana", "telefone": "(61) 99975-5859", "email": "tarciana@tarcianaaraujo.com.br"}]'::jsonb, '[{"dia": "Última segunda-feira", "local": "Santíssimo", "horario": "20h", "observacao": ""}, {"dia": "1º domingo", "local": "Igreja", "horario": "19h", "observacao": "Missa"}]'::jsonb, null),
  (27, 'Terço dos Homens', '[{"nome": "Alino Donizette", "telefone": "(61) 99981-0662", "email": "alinodqueiroz@gmail.com"}, {"nome": "Palmerio Peixoto", "telefone": "(61) 99989-1952", "email": "palmerio.carmo@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Centro Catequético", "horario": "20h", "observacao": ""}]'::jsonb, null),
  (28, 'Vicentinos', '[{"nome": "Jaques N. de Freitas", "telefone": "(61) 99961-4736", "email": "jaquesnfreitas@gmail.com"}, {"nome": "Simone Silva da Costa", "telefone": "(61) 98416-1063", "email": ""}, {"nome": "Ana Nery de L. Caixeta", "telefone": "(61) 98444-4184", "email": ""}, {"nome": "Ailton Angelo da Silva", "telefone": "(61) 98578-3305", "email": "ailtonangelosjunior@gmail.com"}]'::jsonb, '[{"dia": "Segunda-feira", "local": "Sala dos Vicentinos", "horario": "20h", "observacao": "Conf. S. J. Batista"}, {"dia": "Quinta-feira", "local": "Sala dos Vicentinos", "horario": "20h", "observacao": "Conf. São José"}, {"dia": "Quinta-feira", "local": "Sala dos Vicentinos", "horario": "19h", "observacao": "Conf. Santa Luzia"}, {"dia": "Terça-feira", "local": "Sala dos Vicentinos", "horario": "19h", "observacao": "Conf. Imaculada Conceição"}]'::jsonb, 'Reunião geral no 4º sábado.')
) as v(numero, nome, coordenadores, reunioes, observacao)
where not exists (select 1 from pastorais);
