// Chaves PÚBLICAS do Supabase (Project Settings > API).
// A chave "anon" pode ficar no site: a segurança vem das regras (RLS) do banco.
export const SUPABASE_URL = 'https://qgendjvoqrdhpiqphqld.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZW5kanZvcXJkaHBpcXBocWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NTEyMDksImV4cCI6MjEwNzQyNzIwOX0.DIuYLayW-ZFKzYdf0A5JnMrhjoT7fXrqeDYmEgcxyeo';

// Endereço público do site, usado no link do comprovante enviado por WhatsApp/e-mail.
// Ex.: 'https://paroquiasaojose.github.io/agenda-salas'
export const SITE_URL = window.location.origin + window.location.pathname.replace(/\/(admin\/)?[^/]*$/, '');

export const NOME_APP = 'Reservas de salas - Paróquia São José';
export const FUSO = 'America/Sao_Paulo';