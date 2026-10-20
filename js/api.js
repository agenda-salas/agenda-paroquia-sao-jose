// Acesso ao banco (Supabase)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { hojeISO, somaDias } from './util.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CACHE = 'salas-sj:';

function guardar(chave, valor) {
  try { localStorage.setItem(CACHE + chave, JSON.stringify({ em: Date.now(), valor })); } catch {}
}
function recuperar(chave) {
  try { return JSON.parse(localStorage.getItem(CACHE + chave)); } catch { return null; }
}

// Lê do banco; sem internet, devolve a última cópia guardada (com o horário dela)
async function comCache(chave, consulta) {
  try {
    const { data, error } = await consulta();
    if (error) throw error;
    guardar(chave, data);
    return { dados: data, deCache: null };
  } catch (e) {
    const c = recuperar(chave);
    if (c) return { dados: c.valor, deCache: new Date(c.em) };
    throw e;
  }
}

export function nomeSala(s) {
  return s.nome || `Sala ${s.numero}`;
}

export async function carregarSalas() {
  return comCache('salas', () =>
    sb.from('salas').select('*').eq('ativa', true).order('ordem').order('numero'));
}

export async function carregarSala(id) {
  const { data, error } = await sb.from('salas').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function carregarTurnos() {
  return comCache('turnos', () => sb.from('turnos').select('*').order('ordem'));
}

// Nomes de pastorais e grupos já usados (sugestões ao digitar)
export async function gruposUsados() {
  const { data, error } = await sb.rpc('grupos_usados');
  if (error) return [];
  return (data || []).map((x) => (typeof x === 'string' ? x : x.grupos_usados)).filter(Boolean);
}

export async function carregarConfig() {
  const { dados } = await comCache('config', () => sb.from('configuracoes').select('chave, valor'));
  return Object.fromEntries((dados || []).map((c) => [c.chave, c.valor]));
}

// Agenda pública entre duas datas (inclusive); salaId opcional
export async function carregarAgenda(inicio, fim, salaId) {
  sb.rpc('expirar_pendentes').then(() => {}, () => {});
  const chave = `agenda:${salaId || 'todas'}:${inicio}:${fim}`;
  return comCache(chave, () => {
    let q = sb.from('agenda_publica').select('*').gte('data', inicio).lte('data', fim);
    if (salaId) q = q.eq('sala_id', salaId);
    return q;
  });
}

export async function carregarBloqueios(inicio, fim, salaId) {
  const chave = `bloq:${salaId || 'todas'}:${inicio}:${fim}`;
  return comCache(chave, () => {
    let q = sb.from('bloqueios').select('*').lte('data_inicio', fim).gte('data_fim', inicio);
    if (salaId) q = q.eq('sala_id', salaId);
    return q;
  });
}

export async function criarReserva({ salaId, data, turnos, nome, telefone, grupo, motivo, tipo, endereco, paroquia, paroco }) {
  const { data: codigo, error } = await sb.rpc('criar_reserva', {
    p_sala_id: salaId,
    p_data: data,
    p_turnos: turnos,
    p_nome: nome,
    p_telefone: telefone,
    p_grupo: grupo,
    p_motivo: motivo || null,
    p_tipo: tipo === 'externo' ? 'externo' : 'paroquiano',
    p_endereco: endereco || null,
    p_paroquia: paroquia || null,
    p_paroco: paroco || null,
  });
  if (error) throw new Error(limparErro(error));
  return codigo;
}

export async function obterComprovante(codigo) {
  const { data, error } = await sb.rpc('obter_comprovante', { p_codigo: codigo });
  if (error) throw new Error(limparErro(error));
  return data || [];
}

// Turnos do pedido (só o dono ou a secretaria conseguem ler)
export async function dadosDaMinhaReserva(codigo) {
  const { data, error } = await sb.from('reservas')
    .select('codigo, sala_id, data, status, tipo, turnos(codigo, inicio, ordem)')
    .eq('codigo', codigo);
  if (error) throw new Error(limparErro(error));
  return data || [];
}

export async function cancelarMinhaReserva(codigo) {
  const { error } = await sb.rpc('cancelar_minha_reserva', { p_codigo: codigo });
  if (error) throw new Error(limparErro(error));
}

export async function alterarMinhaReserva(codigo, data, turnos) {
  const { data: novo, error } = await sb.rpc('alterar_minha_reserva', { p_codigo: codigo, p_data: data, p_turnos: turnos });
  if (error) throw new Error(limparErro(error));
  return novo;
}

export async function minhasReservas() {
  // Sempre só as reservas da conta logada (a secretaria pode ler todas, mas aqui só aparecem as dela)
  const { data: sessaoAtual } = await sb.auth.getSession();
  const uid = sessaoAtual.session?.user?.id;
  if (!uid) return [];
  const campos = 'codigo, sala_id, data, status, motivo_recusa, salas(numero, nome), turnos(codigo, nome, inicio, fim, ordem), grupo';
  const busca = (extra) => sb.from('reservas').select(campos + extra)
    .eq('solicitante_id', uid)
    .gte('data', somaDias(hojeISO(), -30))
    .order('data', { ascending: false });
  let { data, error } = await busca(', oculta_solicitante');
  if (error) ({ data, error } = await busca(''));   // banco ainda sem a coluna
  if (error) throw error;
  return (data || []).filter((r) => !r.oculta_solicitante);
}

// Pedidos de Direcionamento Espiritual da própria pessoa
export async function meusAtendimentos() {
  const { data, error } = await sb.rpc('meus_atendimentos');
  if (error) return [];
  return data || [];
}

export async function cancelarMeuAtendimento(id) {
  const { error } = await sb.rpc('cancelar_meu_atendimento', { p_id: id });
  if (error) throw new Error(limparErro(error));
}

// "Excluir" de um cartão encerrado (só tira da lista da pessoa)
export async function ocultarMinhaReserva(codigo) {
  const { error } = await sb.rpc('ocultar_minha_reserva', { p_codigo: codigo });
  if (error) throw new Error(limparErro(error));
}

export async function ocultarMeuAtendimento(id) {
  const { error } = await sb.rpc('ocultar_meu_atendimento', { p_id: id });
  if (error) throw new Error(limparErro(error));
}

// "Limpar canceladas e recusadas": tira da lista da pessoa (a secretaria continua vendo)
export async function limparMinhasReservas() {
  const { data, error } = await sb.rpc('limpar_minhas_reservas');
  if (error) throw new Error(limparErro(error));
  return data || 0;
}

export function limparErro(error) {
  const m = (error && (error.message || error.error_description)) || 'Não foi possível concluir. Tente de novo.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com a internet. Reservar exige conexão.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/User already registered/i.test(m)) return 'Este e-mail já tem cadastro. Use a aba Entrar.';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas seguidas. Aguarde um minuto.';
  if (/Signups not allowed/i.test(m)) return 'Novos cadastros estão desativados no momento.';
  return m;
}
