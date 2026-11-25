import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { notify } from '../../utils/notify';

/**
 * Arrastar e soltar arquivos em qualquer tela de importação.
 * Ao arrastar um arquivo por cima da página, a área de importação mais próxima do ponteiro fica destacada; ao soltar, o arquivo
 * vai para o mesmo campo "Escolher arquivo" daquela área (como se tivesse sido escolhido ali). Respeita os tipos aceitos
 * (.xlsx, .pdf...) e se o campo aceita vários arquivos. Um campo marcado com data-sem-soltar nunca recebe arquivo solto (ex.: restaurar backup).
 * Telas em que a importação fica atrás de um botão (janela que abre ao clicar) marcam o botão com data-soltar-abre: soltar o arquivo
 * na página abre essa janela e entrega o arquivo ao campo dela.
 * Soltar um arquivo fora de qualquer área não faz nada (o navegador não abre o arquivo e não tira você do sistema).
 */
const temArquivos = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
const visivel = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

function aceita(input: HTMLInputElement, f: { name: string; type: string }): boolean {
  const acc = (input.accept || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!acc.length) return true;
  const nome = f.name.toLowerCase();
  return acc.some(a => (a.startsWith('.') ? nome.endsWith(a) : a.endsWith('/*') ? (f.type || '').toLowerCase().startsWith(a.slice(0, -1)) : (f.type || '').toLowerCase() === a));
}

/** Procura, subindo a partir do ponto onde o arquivo está, a área mais próxima que tenha um campo de arquivo compatível. */
/** `arquivos` nulo = durante o arrastar (o navegador ainda não informa os nomes): vale qualquer campo de arquivo. */
export function acharAlvo(inicio: Element | null, arquivos: { name: string; type: string }[] | null): { area: HTMLElement; input: HTMLInputElement } | null {
  let el: Element | null = inicio;
  while (el && el !== document.body) {
    if (visivel(el)) {
      const inputs = Array.from(el.querySelectorAll('input[type=file]')) as HTMLInputElement[];
      const ok = inputs.find(i => !i.disabled && !i.hasAttribute('data-sem-soltar') && (arquivos === null || (arquivos.length > 0 && arquivos.some(f => aceita(i, f)))));
      if (ok) return { area: el as HTMLElement, input: ok };
      // área com campo de arquivo que não aceita este tipo: não sobe para uma área maior e engana
      if (inputs.length) return null;
    }
    el = el.parentElement;
  }
  return null;
}

/** Botão da página que abre a janela de importação (marcado com data-soltar-abre), se houver um visível e nenhuma janela aberta. */
const abridor = (): HTMLElement | null => {
  if (document.querySelector('[role=dialog]')) return null;
  return (Array.from(document.querySelectorAll('[data-soltar-abre]')) as HTMLElement[]).find(b => visivel(b) && !(b as HTMLButtonElement).disabled) || null;
};

function entregar(input: HTMLInputElement, files: File[]) {
  const aceitos = files.filter(f => aceita(input, f));
  const lista = input.multiple ? aceitos : aceitos.slice(0, 1);
  if (!lista.length) return 0;
  const dt = new DataTransfer();
  lista.forEach(f => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return lista.length;
}

export const SoltarArquivos: React.FC = () => {
  const [dica, setDica] = useState<{ texto: string; ok: boolean } | null>(null);
  const marcada = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const desmarcar = () => { marcada.current?.removeAttribute('data-soltar'); marcada.current = null; };
    const sobre = (e: DragEvent) => {
      if (!temArquivos(e)) return;
      e.preventDefault();
      // durante o arrastar o navegador não informa os nomes: vale qualquer campo; a conferência de extensão é feita ao soltar
      const alvo = acharAlvo(e.target as Element, null);
      const area = alvo?.area ?? null;
      if (area !== marcada.current) { desmarcar(); if (area) { area.setAttribute('data-soltar', '1'); marcada.current = area; } }
      if (e.dataTransfer) e.dataTransfer.dropEffect = area ? 'copy' : 'none';
      const abre = !area && abridor();
      setDica(area ? { texto: 'Solte aqui para importar', ok: true } : abre ? { texto: 'Solte aqui para abrir a importação', ok: true } : { texto: 'Não há onde importar arquivos nesta área', ok: false });
      if (abre && e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const saiu = (e: DragEvent) => { if (!e.relatedTarget) { desmarcar(); setDica(null); } };
    const soltou = (e: DragEvent) => {
      if (!temArquivos(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      desmarcar(); setDica(null);
      const alvo = acharAlvo(e.target as Element, files);
      if (!alvo) {
        // a importação fica atrás de um botão: abre a janela e entrega o arquivo ao campo dela
        const abre = abridor();
        if (abre) {
          abre.click();
          let tentativas = 0;
          const esperar = () => {
            const dlg = document.querySelector('[role=dialog]');
            const t = dlg ? acharAlvo(dlg, files) : null;
            if (t) { if (!entregar(t.input, files)) notify.info('Este tipo de arquivo não é aceito nesta área.'); return; }
            if (++tentativas < 20) setTimeout(esperar, 100); else notify.info('Abri a importação, mas ela não aceita este tipo de arquivo. Use o botão de escolher arquivo.');
          };
          setTimeout(esperar, 50);
          return;
        }
        notify.info('Não há onde importar este arquivo aqui (ou o tipo não é aceito nesta área). Solte sobre uma área de importação, ou use o botão de escolher arquivo.');
        return;
      }
      if (!entregar(alvo.input, files)) notify.info('Este tipo de arquivo não é aceito nesta área.');
    };
    window.addEventListener('dragenter', sobre); window.addEventListener('dragover', sobre); window.addEventListener('dragleave', saiu); window.addEventListener('drop', soltou);
    return () => { window.removeEventListener('dragenter', sobre); window.removeEventListener('dragover', sobre); window.removeEventListener('dragleave', saiu); window.removeEventListener('drop', soltou); desmarcar(); };
  }, []);
  if (!dica) return null;
  return (
    <div role="status" aria-live="polite" data-testid="dica-soltar"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-sm font-semibold pointer-events-none ${dica.ok ? 'bg-primary-600 text-white' : 'bg-slate-800 text-white'}`}>
      <UploadCloud size={16} />{dica.texto}
    </div>
  );
};
