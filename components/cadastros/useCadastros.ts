import { useCallback, useEffect, useState } from 'react';
import { cadastroService, CadastroNaoInstaladoError } from '../../services/cadastroService';
import { ClasseNavio, Comando, OM, ServicoCatalogo, Setor } from '../../types';
import { db } from '../../services/db';

export interface DadosCadastro {
  setores: Setor[];
  comandos: Comando[];
  classes: ClasseNavio[];
  oms: OM[];
  servicos: ServicoCatalogo[];
}

const VAZIO: DadosCadastro = { setores: [], comandos: [], classes: [], oms: [], servicos: [] };

/** Carrega todos os cadastros de uma vez (são tabelas pequenas) e informa se o script 002 falta. */
export function useCadastros() {
  const [dados, setDados] = useState<DadosCadastro>(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [naoInstalado, setNaoInstalado] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [setores, comandos, classes, oms, servicos] = await Promise.all([
        cadastroService.listSetores(), cadastroService.listComandos(), cadastroService.listClasses(),
        cadastroService.listOMs(), cadastroService.listServicos(),
      ]);
      setDados({ setores, comandos, classes, oms, servicos });
      setNaoInstalado(false);
      // telas de Faturas/Saldos usam o cadastro para preencher o cliente
      db.invalidateCache('clients', 'services');
    } catch (e: any) {
      if (e instanceof CadastroNaoInstaladoError) setNaoInstalado(true);
      else setErro(e?.message || 'Erro ao carregar cadastros.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);
  return { dados, carregando, erro, naoInstalado, recarregar };
}
