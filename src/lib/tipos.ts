export type Papel = 'dono' | 'gerente' | 'caixa' | 'garcom';
export type StatusPedido = 'novo' | 'preparando' | 'pronto' | 'entregue' | 'cancelado';

export interface Restaurante {
  id: string;
  nome: string;
  slogan: string | null;
  logo_url: string | null;
  cor: string;
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
  vegetariano: boolean;
  picancia: number;
  destaque: boolean;
  novo: boolean;
  ativo: boolean;
  ordem: number;
  controla_estoque: boolean;
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

export interface MovimentoEstoque {
  id: string;
  produto_id: string;
  delta: number;
  motivo: string;
  criado_em: string;
  produto?: { nome: string } | null;
}
