/**
 * Gráficos nativos do Excel/LibreOffice em planilhas geradas com a biblioteca xlsx (que não cria gráficos):
 * injeta no pacote .xlsx o desenho (drawing) e as partes de gráfico (barras, linhas, combinado com eixo secundário).
 */
import JSZip from 'jszip';

export interface SerieXl {
  nome: string; cat: string; val: string; // intervalos, ex.: 'Gráficos'!$A$3:$A$14
  cor: string; tipo?: 'bar' | 'line'; secundario?: boolean; coresPontos?: string[];
}
export interface GraficoXl {
  titulo: string; series: SerieXl[];
  de: { col: number; row: number }; ate: { col: number; row: number }; // células (0-based), canto superior esquerdo e inferior direito
  formato?: string; formatoSec?: string;
  /** barras na horizontal (ranking, 1º item no alto) e/ou empilhadas */
  horizontal?: boolean; empilhado?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cor = (c: string) => c.replace('#', '').toUpperCase();
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const fill = (c: string) => `<a:solidFill><a:srgbClr val="${cor(c)}"/></a:solidFill>`;
const refs = (s: SerieXl, i: number, extra: string) =>
  `<c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.nome)}</c:v></c:tx>${extra}<c:cat><c:strRef><c:f>${esc(s.cat)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(s.val)}</c:f></c:numRef></c:val>`;

function serieBarra(s: SerieXl, i: number) {
  const pts = (s.coresPontos || []).map((c, k) => `<c:dPt><c:idx val="${k}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${fill(c)}</c:spPr></c:dPt>`).join('');
  return `<c:ser>${refs(s, i, `<c:spPr>${fill(s.cor)}</c:spPr><c:invertIfNegative val="0"/>${pts}`)}</c:ser>`;
}
function serieLinha(s: SerieXl, i: number) {
  const sp = `<c:spPr><a:ln w="28575" cap="rnd">${fill(s.cor)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${fill(s.cor)}</c:spPr></c:marker>`;
  return `<c:ser>${refs(s, i, sp)}<c:smooth val="0"/></c:ser>`;
}
const eixoCat = (id: number, cruza: number, apagado: boolean, horiz = false) =>
  `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="${horiz ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="${apagado ? 1 : 0}"/><c:axPos val="${horiz ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="${cruza}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
const eixoVal = (id: number, cruza: number, fmt: string, direita: boolean, horiz = false) =>
  `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'b' : direita ? 'r' : 'l'}"/>${direita ? '' : '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'}<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cruza}"/><c:crosses val="${direita || horiz ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;

export function xmlGrafico(g: GraficoXl): string {
  const prim = g.series.filter(s => !s.secundario), sec = g.series.filter(s => s.secundario);
  let i = 0;
  const grupo = (ss: SerieXl[], a: number, b: number) => {
    const barras = ss.filter(s => (s.tipo || 'bar') === 'bar'), linhas = ss.filter(s => s.tipo === 'line');
    return (barras.length ? `<c:barChart><c:barDir val="${g.horizontal ? 'bar' : 'col'}"/><c:grouping val="${g.empilhado ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${barras.map(s => serieBarra(s, i++)).join('')}<c:gapWidth val="${g.horizontal ? 40 : 80}"/>${g.empilhado ? '<c:overlap val="100"/>' : ''}<c:axId val="${a}"/><c:axId val="${b}"/></c:barChart>` : '')
      + (linhas.length ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${linhas.map(s => serieLinha(s, i++)).join('')}<c:marker val="1"/><c:axId val="${a}"/><c:axId val="${b}"/></c:lineChart>` : '');
  };
  const corpo = grupo(prim, 111, 112) + (sec.length ? grupo(sec, 113, 114) : '')
    + eixoCat(111, 112, false, !!g.horizontal) + eixoVal(112, 111, g.formato || '#,##0', false, !!g.horizontal)
    + (sec.length ? eixoCat(113, 114, true) + eixoVal(114, 113, g.formatoSec || '0"%"', true) : '');
  const titulo = `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="1200" b="1"/><a:t>${esc(g.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>${titulo}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${corpo}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

const ancora = (g: GraficoXl, n: number) =>
  `<xdr:twoCellAnchor><xdr:from><xdr:col>${g.de.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.de.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${g.ate.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.ate.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
  + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n + 1}" name="Gráfico ${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${n}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

/** Acrescenta os gráficos à aba `aba` de um .xlsx já gerado e devolve o novo arquivo. */
export async function injetarGraficos(arquivo: ArrayBuffer | Uint8Array, aba: string, graficos: GraficoXl[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(arquivo);
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  const m = [...wbXml.matchAll(/<sheet [^>]*>/g)].map(x => x[0]).find(t => t.includes(`name="${esc(aba)}"`));
  const rid = m && /r:id="([^"]+)"/.exec(m)?.[1];
  if (!rid) throw new Error(`Aba "${aba}" não encontrada`);
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const alvo = new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0].match(/Target="([^"]+)"/)?.[1];
  if (!alvo) throw new Error('Relação da aba não encontrada');
  const caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`;
  const nomeArq = caminho.split('/').pop()!;

  let tipos = await zip.file('[Content_Types].xml')!.async('string');
  const novos: string[] = [`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`];
  graficos.forEach((g, k) => {
    const n = k + 1;
    zip.file(`xl/charts/chart${n}.xml`, xmlGrafico(g));
    novos.push(`<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  });
  tipos = tipos.replace('</Types>', `${novos.join('')}</Types>`);
  zip.file('[Content_Types].xml', tipos);

  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${graficos.map((g, k) => ancora(g, k + 1)).join('')}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${graficos.map((_, k) => `<Relationship Id="rId${k + 1}" Type="${NS_R}/chart" Target="../charts/chart${k + 1}.xml"/>`).join('')}</Relationships>`);
  zip.file(`xl/worksheets/_rels/${nomeArq}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  const planilha = await zip.file(caminho)!.async('string');
  // impressão: paisagem, ajustada à largura de 1 página (a aba tem tabela e gráficos lado a lado)
  let xml = planilha.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
  if (!/<sheetPr[ >]/.test(xml)) xml = xml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  if (!/<pageSetup /.test(xml)) {
    const config = '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
    xml = /<ignoredErrors/.test(xml) ? xml.replace('<ignoredErrors', `${config}<ignoredErrors`) : xml.replace('<drawing ', `${config}<drawing `);
  }
  zip.file(caminho, xml);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
