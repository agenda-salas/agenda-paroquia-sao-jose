// Baixar relações em PDF ou Excel (gerados no próprio navegador).
// As bibliotecas só são carregadas quando a secretaria pede o arquivo.
const LIBS = {
  pdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  tabela: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
  excel: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
};
const carregados = {};

function carregarScript(url) {
  if (!carregados[url]) {
    carregados[url] = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = ok;
      s.onerror = () => { delete carregados[url]; falha(new Error('Não foi possível carregar o gerador de arquivos. Confira a internet e tente de novo.')); };
      document.head.append(s);
    });
  }
  return carregados[url];
}

const VERDE = [64, 98, 63];
const OURO = [212, 168, 63];

// PDF em A4. secoes: [{ titulo?, colunas: [...], linhas: [[...]], larguras?: {indice: mm} }]
export async function baixarPDF({ arquivo, titulo, subtitulo, secoes, deitado = true }) {
  await carregarScript(LIBS.pdf);
  await carregarScript(LIBS.tabela);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: deitado ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const largura = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...OURO);
  doc.text('PARÓQUIA SÃO JOSÉ · TAGUATINGA NORTE - DF', 14, 14);
  doc.setFontSize(16);
  doc.setTextColor(...VERDE);
  doc.text(titulo, 14, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  if (subtitulo) doc.text(subtitulo, 14, 28);
  doc.setDrawColor(...OURO);
  doc.setLineWidth(0.8);
  doc.line(14, 31, largura - 14, 31);

  let y = 36;
  for (const s of secoes) {
    if (s.titulo) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...VERDE);
      doc.text(s.titulo, 14, y + 2);
      y += 5;
    }
    doc.autoTable({
      startY: y,
      head: [s.colunas],
      body: s.linhas,
      margin: { left: 14, right: 14 },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, valign: 'top', lineColor: [225, 228, 222], lineWidth: 0.2 },
      headStyles: { fillColor: VERDE, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 248, 244] },
      columnStyles: Object.fromEntries(Object.entries(s.larguras || {}).map(([i, w]) => [i, { cellWidth: w }])),
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`Secretaria paroquial · página ${i} de ${paginas}`, largura - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }
  doc.save(`${arquivo}.pdf`);
}

// Excel (.xlsx). abas: [{ nome, colunas: [...], linhas: [[...]], larguras?: [chars] }]
export async function baixarExcel({ arquivo, abas }) {
  await carregarScript(LIBS.excel);
  const XLSX = window.XLSX;
  const livro = XLSX.utils.book_new();
  for (const a of abas) {
    const folha = XLSX.utils.aoa_to_sheet([a.colunas, ...a.linhas]);
    folha['!cols'] = (a.larguras || a.colunas.map(() => 18)).map((w) => ({ wch: w }));
    folha['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: a.linhas.length, c: a.colunas.length - 1 } }) };
    XLSX.utils.book_append_sheet(livro, folha, a.nome.slice(0, 31));
  }
  XLSX.writeFile(livro, `${arquivo}.xlsx`);
}

// Janela "Baixar arquivos": escolhe PDF ou Excel
export function escolherFormato(titulo, gerar) {
  const dlg = document.getElementById('dlg-baixar');
  const msg = document.getElementById('bx-msg');
  document.getElementById('bx-titulo').textContent = titulo;
  msg.hidden = true;
  dlg.querySelectorAll('[data-formato]').forEach((b) => {
    b.disabled = false;
    b.onclick = async () => {
      dlg.querySelectorAll('[data-formato]').forEach((x) => { x.disabled = true; });
      msg.className = 'aviso aviso-info';
      msg.textContent = 'Gerando o arquivo…';
      msg.hidden = false;
      try {
        await gerar(b.dataset.formato);
        dlg.close();
      } catch (e) {
        msg.className = 'aviso aviso-erro';
        msg.textContent = e.message || 'Não foi possível gerar o arquivo.';
        dlg.querySelectorAll('[data-formato]').forEach((x) => { x.disabled = false; });
      }
    };
  });
  dlg.showModal();
}

// "2026-10-24" para o nome do arquivo
export const hojeArquivo = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Busca todas as linhas (o Supabase devolve no máximo 1000 por vez)
export async function buscarTudo(montarConsulta) {
  const todas = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await montarConsulta().range(ini, ini + 999);
    if (error) throw error;
    todas.push(...(data || []));
    if (!data || data.length < 1000) return todas;
  }
}

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
export { dataBR };

// Janela de relatório: período (e, opcionalmente, solicitante) + PDF ou Excel
// cfg: { titulo, nota, solicitantes?: async (de, ate) => [nomes], gerar: async (formato, { de, ate, solicitante }) }
export function abrirRelatorio(cfg) {
  const dlg = document.getElementById('dlg-relatorio');
  const f = document.getElementById('f-relatorio');
  const msg = document.getElementById('rl-msg');
  const campoSolic = document.getElementById('rl-campo-solic');
  document.getElementById('rl-titulo').textContent = cfg.titulo;
  document.getElementById('rl-nota').textContent = cfg.nota || '';
  msg.hidden = true;
  const hoje = hojeArquivo();
  if (!f.de.value) f.de.value = `${hoje.slice(0, 7)}-01`;
  if (!f.ate.value) f.ate.value = hoje;
  campoSolic.hidden = !cfg.solicitantes;

  const atualizarSolicitantes = async () => {
    if (!cfg.solicitantes || !f.de.value || !f.ate.value) return;
    const atual = f.solicitante.value;
    try {
      const nomes = await cfg.solicitantes(f.de.value, f.ate.value);
      f.solicitante.innerHTML = '<option value="">Todos os solicitantes</option>'
        + nomes.map((n) => `<option>${n.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join('');
      if (nomes.includes(atual)) f.solicitante.value = atual;
    } catch { /* a lista fica como está */ }
  };
  f.de.onchange = atualizarSolicitantes;
  f.ate.onchange = atualizarSolicitantes;
  atualizarSolicitantes();

  dlg.querySelectorAll('[data-rl-formato]').forEach((b) => {
    b.disabled = false;
    b.onclick = async () => {
      if (!f.de.value || !f.ate.value || f.ate.value < f.de.value) {
        msg.className = 'aviso aviso-erro';
        msg.textContent = 'Informe o período: a data final precisa ser igual ou depois da inicial.';
        msg.hidden = false;
        return;
      }
      dlg.querySelectorAll('[data-rl-formato]').forEach((x) => { x.disabled = true; });
      msg.className = 'aviso aviso-info';
      msg.textContent = 'Gerando o arquivo…';
      msg.hidden = false;
      try {
        await cfg.gerar(b.dataset.rlFormato, { de: f.de.value, ate: f.ate.value, solicitante: cfg.solicitantes ? f.solicitante.value : '' });
        dlg.close();
      } catch (e) {
        msg.className = 'aviso aviso-erro';
        msg.textContent = e.message || 'Não foi possível gerar o arquivo.';
      }
      dlg.querySelectorAll('[data-rl-formato]').forEach((x) => { x.disabled = false; });
    };
  });
  dlg.showModal();
}
