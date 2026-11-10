/**
 * Modo treinamento (perfil "Treinamento"): o usuário vê os dados reais, mas tudo o que lança vai para uma cópia de teste
 * guardada neste navegador. Nada é enviado ao banco: a escrita não sai daqui, e o banco ainda recusa qualquer escrita
 * desse perfil (as políticas só liberam administrador e operador).
 *
 * Funciona como um "porteiro" no fetch do cliente Supabase: leituras vão ao servidor e voltam misturadas com o que foi
 * lançado de teste; escritas são gravadas só na cópia de teste.
 */
import { Consulta, EstadoTreino, Linha, alvosDaEscrita, apagarTeste, chaveDe, classificar, estadoVazio, gravarTeste, lerConsulta, misturarLeitura, temAlteracoes, totalDeTeste } from '../utils/treinoSandbox';

const CHAVE = (usuario: string) => `siscont-treino-v1:${usuario}`;
let usuarioAtivo: string | null = null;
let estado: EstadoTreino = estadoVazio();

export const modoTreino = () => !!usuarioAtivo;
export const totalLancamentosDeTeste = () => totalDeTeste(estado);

function carregar(usuario: string): EstadoTreino {
  try {
    const bruto = localStorage.getItem(CHAVE(usuario));
    const e = bruto ? JSON.parse(bruto) : null;
    if (e && e.v === 1 && e.tabelas) return e as EstadoTreino;
  } catch { /* sem acesso ao armazenamento: começa vazio */ }
  return estadoVazio();
}
function salvar() {
  if (!usuarioAtivo) return;
  try { localStorage.setItem(CHAVE(usuarioAtivo), JSON.stringify(estado)); } catch { /* cheio ou bloqueado: segue só em memória */ }
}

/** Liga o modo treinamento para este usuário (null desliga). */
export function ativarTreino(usuario: string | null) {
  usuarioAtivo = usuario;
  estado = usuario ? carregar(usuario) : estadoVazio();
}
/** Apaga todos os lançamentos de teste do usuário. */
export function zerarTreino() {
  const u = usuarioAtivo;
  estado = estadoVazio();
  try { if (u) localStorage.removeItem(CHAVE(u)); } catch { /* ignore */ }
}

const resposta = (status: number, corpo: unknown, cab: Record<string, string> = {}) =>
  new Response(corpo === undefined || status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...cab } });

/** O "porteiro": envolve o fetch do cliente Supabase. */
export function criarFetchTreino(real: typeof fetch): typeof fetch {
  return async (entrada: RequestInfo | URL, init?: RequestInit) => {
    if (!usuarioAtivo) return real(entrada, init);
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : (entrada as Request).url);
    const metodo = (init?.method || (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
    const cab = new Headers(init?.headers || (entrada instanceof Request ? entrada.headers : undefined));
    const destino = classificar(metodo, url.pathname);

    if (destino.tipo === 'passar') return real(entrada, init);
    if (destino.tipo === 'bloquear') return resposta(400, { code: 'TREINO', message: destino.motivo, details: null, hint: null });

    const tabela = destino.tabela;
    const c: Consulta = lerConsulta(url.searchParams);
    const prefer = cab.get('prefer') || '';
    const quer = prefer.includes('return=representation');
    const unico = (cab.get('accept') || '').includes('vnd.pgrst.object+json');

    /** Linhas reais da tabela com os mesmos filtros (para atualizar/apagar e para completar um upsert). */
    const lerReais = async (filtrosDe: URL): Promise<Linha[]> => {
      const u = new URL(filtrosDe.toString()); u.searchParams.set('select', '*'); ['order', 'limit', 'offset'].forEach(k => u.searchParams.delete(k));
      const h = new Headers(); ['authorization', 'apikey'].forEach(k => { const v = cab.get(k); if (v) h.set(k, v); });
      const r = await real(u.toString(), { method: 'GET', headers: h });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    };

    // ---------------------------------------------------------------- leitura
    if (metodo === 'GET') {
      if (!temAlteracoes(estado, tabela)) return real(entrada, init);
      const h2 = new Headers(cab); if (unico) h2.set('accept', 'application/json');
      const r = await real(url.toString(), { ...init, headers: h2 });
      if (!r.ok) return r;
      const reais = await r.clone().json();
      if (!Array.isArray(reais)) return r;
      const ultima = c.limite === undefined || reais.length < c.limite;
      const mix = misturarLeitura(estado, tabela, reais, c, ultima);
      const cr = r.headers.get('content-range');
      const saida: Record<string, string> = {};
      if (cr) {
        const m = cr.match(/^(\d+|\*)(?:-(\d+))?\/(\d+|\*)$/);
        saida['Content-Range'] = m && ultima && m[3] !== '*' ? `${m[1]}${m[2] !== undefined ? `-${Math.max(Number(m[1] === '*' ? 0 : m[1]), Number(m[1] === '*' ? 0 : m[1]) + mix.length - 1)}` : ''}/${Number(m[3]) + (mix.length - reais.length)}` : cr;
      }
      if (unico) return mix.length === 1 ? resposta(200, mix[0], saida) : resposta(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null });
      return resposta(200, mix, saida);
    }
    if (metodo === 'HEAD') return real(entrada, init);

    // ---------------------------------------------------------------- escrita (só na cópia de teste)
    const corpo = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (metodo === 'POST') {
      const novas: Linha[] = Array.isArray(corpo) ? corpo : corpo ? [corpo] : [];
      const ignorar = prefer.includes('ignore-duplicates');
      // upsert parcial de uma linha que já existe no banco: completa com os campos reais
      const comId = novas.filter(n => n.id !== undefined && n.id !== null && !c.conflito?.length);
      const reaisPorId = new Map<string, Linha>();
      if (comId.length && prefer.includes('merge-duplicates')) {
        const u = new URL(url.toString()); u.searchParams.set('id', `in.(${comId.map(n => n.id).join(',')})`);
        (await lerReais(u)).forEach(l => reaisPorId.set(String(l.id), l));
      }
      const gravadas = gravarTeste(estado, tabela, ignorar ? novas.filter(n => !estado.tabelas[tabela]?.linhas[chaveDe(tabela, n, c.conflito)]) : novas, c.conflito, l => (l.id != null ? reaisPorId.get(String(l.id)) : undefined));
      salvar();
      return quer ? resposta(201, unico ? gravadas[0] : gravadas) : resposta(201, undefined);
    }
    if (metodo === 'PATCH' || metodo === 'DELETE') {
      const alvos = alvosDaEscrita(estado, tabela, await lerReais(url), c);
      if (metodo === 'PATCH') {
        const novas = gravarTeste(estado, tabela, alvos.map(a => ({ ...a, ...(corpo || {}) })), c.conflito);
        salvar();
        return quer ? resposta(200, novas) : resposta(204, undefined);
      }
      apagarTeste(estado, tabela, alvos, c.conflito);
      salvar();
      return quer ? resposta(200, alvos) : resposta(204, undefined);
    }
    return resposta(400, { code: 'TREINO', message: 'Modo treinamento: operação não suportada.', details: null, hint: null });
  };
}
