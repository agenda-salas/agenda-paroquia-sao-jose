// Texto e link do comprovante, e o botão Compartilhar
import { SITE_URL } from './config.js';
import { dataLonga, faixa } from './util.js';

export function linkComprovante(codigo) {
  return `${SITE_URL}/comprovante.html?c=${encodeURIComponent(codigo)}`;
}

export function textoComprovante(linhas) {
  const r = linhas[0];
  const turnos = linhas.map((l) => `${l.turno} (${faixa(l)})`).join(', ');
  return [
    `Comprovante de reserva ${r.codigo}`,
    'Paróquia São José · Reservas de salas',
    '',
    `Sala: ${r.sala}`,
    `Data: ${dataLonga(r.data)}`,
    `Turno: ${turnos}`,
    `Grupo: ${r.grupo}`,
    `Responsável: ${r.responsavel}`,
    '',
    'Confira a situação atual:',
  ].join('\n');
}

// Abre o menu de compartilhar do celular (WhatsApp, grupo da pastoral etc.).
// No computador, copia o texto e o link para colar onde quiser.
export async function compartilhar(linhas) {
  const r = linhas[0];
  const texto = textoComprovante(linhas);
  const url = linkComprovante(r.codigo);
  if (navigator.share) {
    try {
      await navigator.share({ title: `Comprovante ${r.codigo}`, text: texto, url });
      return 'compartilhado';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelado';
    }
  }
  try {
    await navigator.clipboard.writeText(`${texto}\n${url}`);
    return 'copiado';
  } catch {
    return 'falhou';
  }
}
