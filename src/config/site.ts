// ============================================================
//  Textos e valores do SITE DE VENDAS — edite à vontade
// ============================================================

export const SITE = {
  marca: 'BasilFiery',

  // WhatsApp de vendas: DDI + DDD + número, só dígitos. Ex.: '5511987654321'
  whatsappVendas: '',

  // Valores de exemplo — ajuste para os seus preços reais
  planos: [
    {
      nome: 'Essencial',
      preco: 'R$ 149',
      periodo: '/mês',
      descricao: 'Para começar a vender pelo tablet.',
      itens: ['Até 10 mesas', 'Cardápio no tablet', 'Painel de pedidos ao vivo', 'Impressão automática no caixa', 'Aviso no celular do garçom'],
      destaque: false,
    },
    {
      nome: 'Profissional',
      preco: 'R$ 249',
      periodo: '/mês',
      descricao: 'Para a casa cheia todos os dias.',
      itens: ['Até 30 mesas', 'Tudo do Essencial', 'Controle de estoque', 'Equipe com cargos e permissões', 'Fotos nos pratos'],
      destaque: true,
    },
    {
      nome: 'Rede',
      preco: 'Sob consulta',
      periodo: '',
      descricao: 'Para quem tem mais de uma unidade.',
      itens: ['Mesas ilimitadas', 'Várias unidades na mesma conta', 'Implantação acompanhada', 'Suporte prioritário'],
      destaque: false,
    },
  ],
};

export function linkWhatsVendas(mensagem = 'Olá! Quero conhecer o BasilFiery para o meu restaurante.') {
  return SITE.whatsappVendas ? `https://wa.me/${SITE.whatsappVendas}?text=${encodeURIComponent(mensagem)}` : null;
}
