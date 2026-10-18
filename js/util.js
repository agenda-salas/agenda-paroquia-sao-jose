// Datas sempre no fuso de Brasília, como texto 'AAAA-MM-DD'
import { FUSO } from './config.js';

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Partes da data/hora atual em Brasília
export function agoraSP() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

export function hojeISO() { return agoraSP().data; }

function partes(iso) { const [a, m, d] = iso.split('-').map(Number); return [a, m, d]; }

export function somaDias(iso, n) {
  const [a, m, d] = partes(iso);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diaSemana(iso) {
  const [a, m, d] = partes(iso);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function difDias(isoA, isoB) {
  const [a1, m1, d1] = partes(isoA);
  const [a2, m2, d2] = partes(isoB);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

export function dataLonga(iso) {
  const [a, m, d] = partes(iso);
  return `${DIAS_LONGOS[diaSemana(iso)]}, ${d} de ${MESES[m - 1]}${a !== partes(hojeISO())[0] ? ' de ' + a : ''}`;
}

export function dataCurta(iso) {
  const [a, m, d] = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

export function hora(t) {
  // '08:30:00' -> '8h30'; '14:00:00' -> '14h'
  const [h, mi] = t.split(':');
  return `${Number(h)}h${mi === '00' ? '' : mi}`;
}

export function faixa(turno) { return `${hora(turno.inicio)} às ${hora(turno.fim)}`; }

export function param(nome) { return new URLSearchParams(location.search).get(nome); }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function iniciais(nome) {
  const p = (nome || '').trim().split(/\s+/);
  return ((p[0] || '')[0] || '').toUpperCase() + ((p.length > 1 ? p[p.length - 1][0] : '') || '').toUpperCase();
}

export function soDigitos(s) { return (s || '').replace(/\D/g, ''); }

// Link do WhatsApp para um telefone, com a mensagem já escrita
export function linkWhatsApp(telefone, texto) {
  const num = soDigitos(telefone);
  const destino = num.length >= 10 ? (num.startsWith('55') && num.length > 11 ? num : `55${num}`) : '';
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto || '')}`;
}

export function primeiroNome(nome) { return (nome || '').trim().split(/\s+/)[0] || ''; }

export function mascaraTelefone(input) {
  input.addEventListener('input', () => {
    const d = soDigitos(input.value).slice(0, 11);
    let v = d;
    if (d.length > 2) v = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) v = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    input.value = v;
  });
}

export const ICONES = {
  voltar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  seta: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  pessoas: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.4c2.3.1 3.9 1.6 4.5 4.6"/></svg>',
  mais: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  limpar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/></svg>',
  ok: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  relogio: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  x: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  whats: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.7L4 20z"/></svg>',
  email: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  compartilhar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  baixar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
};
