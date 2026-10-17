export type Papel = 'dono' | 'gerente' | 'caixa' | 'garcom';
export type StatusPedido = 'novo' | 'preparando' | 'pronto' | 'entregue' | 'cancelado';

export interface Restaurante {
  id: string;
  nome: string;
  slogan: string | null;
  logo_url: string | null;
  cor: string;
  /** Toque do "chamar garçom" (painel e celulares) */
  som_chamado: 'campainha' | 'sino' | 'alerta' | 'marimba';
  plano: string;
  ativo: boolean;
  criado_em: string;
}

export interface RestauranteComPapel extends Restaurante {
  papel: Papel;
}

export interface Membro {
  restaurante_id: string;
  user_id: string;
  papel: Papel;
  nome: string;
  email: string | null;
  criado_em: string;
}

export interface Categoria {
  id: string;
  restaurante_id: string;
  nome: string;
  emoji: string | null;
  ordem: number;
  ativo: boolean;
}

export interface Produto {
  id: string;
  restaurante_id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string;
  preco: number;
  emoji: string | null;
  imagem_url: string | null;
  video_url: string | null;
  /** O que aparece no cartão do tablet: a foto ou o vídeo rodando */
  capa: 'imagem' | 'video';
  vegetariano: boolean;
  picancia: number;
  destaque: boolean;
  novo: boolean;
  ativo: boolean;
  ordem: number;
  controla_estoque: boolean;
  /** false = bebida/item pronto: o pedido pula a etapa "Em preparo" */
  precisa_preparo: boolean;
  estoque: number;
  estoque_minimo: number;
}

export interface Mesa {
  id: string;
  restaurante_id: string;
  nome: string;
  token: string;
  ativo: boolean;
  ordem: number;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  produto_id: string | null;
  nome: string;
  preco_unit: number;
  qtd: number;
  obs: string | null;
}

export interface Pedido {
  id: string;
  restaurante_id: string;
  mesa_id: string | null;
  mesa_nome: string;
  numero: number;
  status: StatusPedido;
  observacao: string | null;
  total: number;
  criado_em: string;
  atualizado_em: string;
  impresso_em: string | null;
  pago_em: string | null;
  /** false = só itens prontos (bebidas): ao aceitar vai direto para "Prontos" */
  precisa_preparo: boolean;
  pedido_itens: PedidoItem[];
}

export interface Chamado {
  id: string;
  restaurante_id: string;
  mesa_id: string | null;
  mesa_nome: string;
  tipo: 'garcom' | 'conta';
  criado_em: string;
  atendido_em: string | null;
}

export type FormaPagamento = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'outro';

export interface ResumoCaixa {
  caixa_id: string;
  aberto_em: string;
  aberto_por_nome: string | null;
  valor_inicial: number;
  ate: string;
  vendas: { pedidos: number; total: number };
  cancelados: { pedidos: number; total: number };
  recebido: number;
  contas_fechadas: number;
  por_forma: Partial<Record<FormaPagamento, number>>;
  dinheiro_esperado: number;
  em_aberto: { mesas: number; total: number };
  // retiradas (sangria) e reforços de troco (ausentes em fechamentos antigos)
  retiradas?: number;
  suprimentos?: number;
  movimentos?: MovimentoCaixa[];
  // só no fechamento
  valor_contado?: number | null;
  diferenca?: number | null;
  fechado_por_nome?: string | null;
  observacao?: string | null;
}

export interface MovimentoCaixa {
  id: string;
  tipo: 'retirada' | 'suprimento';
  valor: number;
  motivo: string | null;
  user_nome: string | null;
  criado_em: string;
}

export interface Caixa {
  id: string;
  restaurante_id: string;
  aberto_em: string;
  aberto_por_nome: string | null;
  valor_inicial: number;
  fechado_em: string | null;
  fechado_por_nome: string | null;
  valor_contado: number | null;
  observacao: string | null;
  resumo: ResumoCaixa | null;
}

export interface MovimentoEstoque {
  id: string;
  produto_id: string;
  delta: number;
  motivo: string;
  criado_em: string;
  produto?: { nome: string } | null;
}
