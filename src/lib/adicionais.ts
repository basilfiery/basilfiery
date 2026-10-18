/* Grupos de adicionais (ex.: "Sabores", mín. 1, máx. 3) — mesmo cálculo que o servidor faz. */

export type CalculoGrupo = 'soma' | 'maior' | 'media';

export interface OpcaoAdicional {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  imagem_url: string | null;
  repetir: boolean;
  disponivel: boolean;
}

export interface GrupoAdicionalMesa {
  id: string;
  nome: string;
  minimo: number;
  maximo: number;
  calculo: CalculoGrupo;
  opcoes: OpcaoAdicional[];
}

export interface Escolha { id: string; qtd: number }

/** Grupos ligados ao produto, na ordem cadastrada. */
export function gruposDoProduto(
  produtoId: string,
  grupos: GrupoAdicionalMesa[] | undefined,
  vinculos: Record<string, string[]> | undefined,
): GrupoAdicionalMesa[] {
  const ids = vinculos?.[produtoId] ?? [];
  return ids.map((id) => grupos?.find((g) => g.id === id)).filter((g): g is GrupoAdicionalMesa => !!g);
}

/** Texto curto da regra do grupo: "Escolha 1 opção", "Escolha até 3", "Escolha de 1 a 3". */
export function regraGrupo(g: { minimo: number; maximo: number }) {
  if (g.minimo === g.maximo) return g.maximo === 1 ? 'Escolha 1 opção' : `Escolha ${g.maximo} opções`;
  if (g.minimo === 0) return g.maximo === 1 ? 'Escolha até 1 opção' : `Escolha até ${g.maximo} opções`;
  return `Escolha de ${g.minimo} a ${g.maximo} opções`;
}

export const ROTULO_CALCULO: Record<CalculoGrupo, string> = {
  soma: 'Soma o preço de cada opção',
  maior: 'Cobra o preço da opção mais cara',
  media: 'Cobra a média dos preços',
};

/** Acréscimo no preço, texto para o pedido e o que ainda falta escolher. */
export function calcularAdicionais(grupos: GrupoAdicionalMesa[], escolhas: Escolha[]) {
  let extra = 0;
  const textos: string[] = [];
  let faltando: string | null = null;
  for (const g of grupos) {
    const doGrupo = g.opcoes
      .map((o) => ({ o, qtd: escolhas.find((e) => e.id === o.id)?.qtd ?? 0 }))
      .filter((x) => x.qtd > 0);
    const total = doGrupo.reduce((s, x) => s + x.qtd, 0);
    if (total < g.minimo && !faltando) {
      faltando = g.minimo === 1 ? `Escolha 1 opção em "${g.nome}"` : `Escolha pelo menos ${g.minimo} em "${g.nome}"`;
    }
    if (!total) continue;
    const soma = doGrupo.reduce((s, x) => s + Number(x.o.preco) * x.qtd, 0);
    const maior = Math.max(...doGrupo.map((x) => Number(x.o.preco)));
    extra += g.calculo === 'maior' ? maior : g.calculo === 'media' ? Math.round((soma / total) * 100) / 100 : soma;
    const partes = doGrupo.map((x) => (g.calculo !== 'soma' && total > 1
      ? (x.qtd === total ? x.o.nome : `${x.qtd}/${total} ${x.o.nome}`)
      : `${x.qtd > 1 ? `${x.qtd}x ` : ''}${x.o.nome}`));
    textos.push(`${g.nome}: ${partes.join(', ')}`);
  }
  return { extra: Math.round(extra * 100) / 100, texto: textos.join(' · '), faltando };
}

/** Identifica a mesma combinação (para juntar no carrinho). */
export const chaveEscolhas = (e: Escolha[] = []) =>
  [...e].sort((a, b) => a.id.localeCompare(b.id)).map((x) => `${x.id}:${x.qtd}`).join(',');
