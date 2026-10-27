export type Papel = 'dono' | 'gerente' | 'caixa' | 'garcom';
export type StatusPedido = 'novo' | 'preparando' | 'pronto' | 'entregue' | 'cancelado';

/** Marca no topo do menu do sistema: BasilFiery, logo + nome próprios, ou só uma imagem larga (16:9) */
export interface MarcaSistema {
  modo: 'padrao' | 'logo_nome' | 'imagem';
  nome?: string;
  sub?: string;
  logo_url?: string | null;
  imagem_url?: string | null;
}

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
  /** Código curto dos links próprios: app do garçom (/g/<codigo>) e delivery (/loja/<codigo>) */
  codigo: string;
  /** Endereço do cardápio: basilfiery.com.br/<slug> (mesas: /<slug>/mesa1) */
  slug: string;
  /** Esgotados no cardápio do cliente: em cinza ('mostrar') ou escondidos ('ocultar') */
  esgotados_modo?: 'mostrar' | 'ocultar';
  /** Meta de faturamento do mês (app do dono) */
  meta_mensal?: number | null;
  /** Domínio próprio (planos Premium e Rede): cardápio em https://<dominio> e mesas em /mesa1 */
  dominio?: string | null;
  dominio_status?: 'pendente' | 'ativo' | null;
  dominio_verificado_em?: string | null;
  /** Logo do menu lateral do sistema (vazio = BasilFiery) */
  marca_sistema?: MarcaSistema | null;
  /** Cor do sistema (Configurações › Aparência). Vazio = laranja tradicional com a cor da loja nos destaques */
  tema_sistema?: 'laranja' | 'vermelho' | 'verde' | null;
  /** Delivery: aceitando pedidos de casa agora */
  delivery_ativo: boolean;
  delivery_taxa: number;
  delivery_minimo: number;
  delivery_tempo: string;
  retirada_ativa: boolean;
  whatsapp: string | null;
  endereco: string | null;
  /** Plano (preenchido pela plataforma) */
  plano_valor: number | null;
  plano_vence_em: string | null;
  plano_forma: string | null;
  /** Estabelecimento */
  segmento: string | null;
  instagram: string | null;
  /** Link do Google Maps da loja */
  mapa_url?: string | null;
  endereco_info: EnderecoLoja | null;
  /** Domingo (0) a sábado (6) */
  horarios: HorarioDia[] | null;
  horarios_ativos: boolean;
  entrega_ativa: boolean;
  formas_pagamento: ('pix' | 'dinheiro' | 'credito' | 'debito')[];
  /** Cardápio digital */
  loja_obs: boolean;
  loja_capa_url: string | null;
  /** Vídeo de capa do cardápio (em cima das categorias) */
  capa_video_url?: string | null;
  loja_descricao: string | null;
  loja_rodape: string | null;
  /** Anúncios (IDs públicos) */
  ads_pixel: string | null;
  ads_ga4: string | null;
  ads_gads: string | null;
  /** Modelos de impressão (cabeçalho, logo, CNPJ, rodapé…) */
  impressao?: import('./impressao').ConfigImpressaoLoja | null;
  /** Taxa de entrega: fixa, por distância (raio) ou por bairro */
  entrega_modo?: 'fixa' | 'raio' | 'bairro';
  entrega_raios?: { ate_km: number; taxa: number }[];
  entrega_bairros?: { nome: string; taxa: number; lat?: number; lng?: number }[];
  lat?: number | null;
  lng?: number | null;
  /** Cartão fidelidade do delivery */
  fidelidade?: { ativo?: boolean; meta?: number; premio?: string; minimo?: number } | null;
}

export interface HorarioDia { aberto: boolean; de: string; ate: string }
export interface EnderecoLoja { cep: string; rua: string; numero: string; bairro: string; cidade: string; uf: string; complemento: string }

/** Dados sensíveis do estabelecimento (só dono e gerente) */
export interface RestauranteDados {
  restaurante_id: string;
  responsavel_nome: string | null;
  responsavel_cpf: string | null;
  responsavel_whatsapp: string | null;
  cnpj: string | null;
  razao_social: string | null;
  capi_token: string | null;
}

export interface Fatura {
  id: string;
  restaurante_id: string;
  referencia: string;
  valor: number;
  vencimento: string;
  pago_em: string | null;
  link: string | null;
  forma?: string | null;
  plano?: string | null;
  criado_em: string;
}

export interface EnderecoEntrega { rua: string; numero: string; bairro: string; complemento?: string | null; referencia?: string | null; distancia_km?: number | null; lat?: number; lng?: number }

export interface RestauranteComPapel extends Restaurante {
  papel: Papel;
}

export interface Membro {
  restaurante_id: string;
  user_id: string;
  papel: Papel;
  nome: string;
  email: string | null;
  foto_url: string | null;
  criado_em: string;
}

export interface Categoria {
  id: string;
  restaurante_id: string;
  nome: string;
  emoji: string | null;
  ordem: number;
  ativo: boolean;
  /** Categoria "mãe" (subcategoria). null = categoria principal */
  pai_id: string | null;
  /** Usa os sabores deste grupo (ex.: tamanho de pizza) */
  grupo_id: string | null;
  /** Preço da subcategoria (ex.: Pizza P R$ 50): os itens dentro custam isso + o acréscimo deles */
  preco_grupo: number | null;
  /** Subcategoria esgotada: tudo dentro dela fica indisponível no tablet */
  esgotado: boolean;
}

export interface Produto {
  id: string;
  restaurante_id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string;
  preco: number;
  /** Quanto custa para a loja (para o lucro). Só dono/gerente usam. */
  custo?: number | null;
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
  /** Sabor de um grupo (ex.: "Sabores de pizza"); aí categoria_id fica vazio e o preço é o acréscimo */
  grupo_id: string | null;
  /** Acabou por agora: aparece "Esgotado" no tablet e não pode ser pedido */
  esgotado: boolean;
  /** Preço "de" (riscado): maior que o preço = item em promoção */
  preco_de?: number | null;
  /** Mais fotos e vídeos */
  galeria?: { tipo: 'imagem' | 'video'; url: string }[];
  /** Exemplo no campo de observação (vazio = automático) */
  dica_obs?: string | null;
}

/** Grupo de sabores compartilhado entre tamanhos (Pizza P, M, G…). */
export interface Grupo {
  id: string;
  restaurante_id: string;
  nome: string;
  ordem: number;
}

export interface Mesa {
  id: string;
  restaurante_id: string;
  nome: string;
  token: string;
  ativo: boolean;
  ordem: number;
  /** Salão, Varanda, Área externa… */
  setor?: string | null;
  /** Quantas pessoas estão na mesa agora (zera ao fechar a conta) */
  pessoas?: number | null;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  produto_id: string | null;
  nome: string;
  preco_unit: number;
  qtd: number;
  obs: string | null;
  /** Adicionais escolhidos, em texto (ex.: "Sabores: 1/2 Calabresa, 1/2 Frango") */
  complementos?: string | null;
  /** Os mesmos adicionais, um por um (sabor, borda, extra) */
  adicionais?: { id?: string; nome: string; grupo?: string | null; qtd?: number; preco?: number }[] | null;
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
  /** mesa | delivery | retirada | balcao (PDV) */
  tipo: 'mesa' | 'delivery' | 'retirada' | 'balcao';
  desconto?: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  endereco: EnderecoEntrega | null;
  forma_pagamento: 'dinheiro' | 'pix' | 'credito' | 'debito' | null;
  troco_para: number | null;
  taxa_entrega: number;
  pedido_itens: PedidoItem[];
}

export interface Chamado {
  id: string;
  restaurante_id: string;
  mesa_id: string | null;
  mesa_nome: string;
  tipo: 'garcom' | 'conta';
  /** O que a mesa precisa (ex.: "Sal e limão"); vazio = só chamou */
  motivo: string | null;
  detalhe: string | null;
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
  // faturamento por tipo de venda e ajustes (ausentes em fechamentos antigos)
  por_tipo?: Partial<Record<'mesa' | 'balcao' | 'delivery' | 'retirada', number>>;
  ajustes?: { descontos: number; acrescimos: number; entregas: number };
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

export type StatusAcesso = 'pendente' | 'liberado' | 'recusado' | 'encerrado';

/** Aparelho (celular/tablet do cliente) pedindo ou com acesso para pedir numa mesa. */
export interface MesaAcesso {
  id: string;
  restaurante_id: string;
  mesa_id: string;
  mesa_nome: string;
  dispositivo: string;
  aparelho: string | null;
  /** Nome e WhatsApp que o cliente informou (opcionais) */
  cliente_nome?: string | null;
  cliente_telefone?: string | null;
  status: StatusAcesso;
  fixo: boolean;
  criado_em: string;
  respondido_em: string | null;
  respondido_por_nome: string | null;
}
