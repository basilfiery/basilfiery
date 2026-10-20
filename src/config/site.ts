// ============================================================
//  Textos e valores do SITE DE VENDAS — edite à vontade
// ============================================================

export const SITE = {
  marca: 'BasilFiery',

  // Domínio oficial (os links usam o endereço em que o sistema está aberto; este é o padrão fora do navegador)
  dominio: 'https://basilfiery.com.br',

  // Contato que aparece nos Termos de uso e na Política de privacidade (e para pedidos de exclusão de dados)
  emailContato: 'basilfiery@gmail.com',

  // WhatsApp de vendas: DDI + DDD + número, só dígitos. Ex.: '5511987654321'
  whatsappVendas: '',

  // Link do checkout da Kirvano ("Assinar agora" no login). Vazio = leva para os planos do site.
  // Cada plano abaixo também pode ter o seu (campo checkout).
  checkoutAssinatura: '',

  // Programa para Windows (instalador publicado nas Releases do GitHub: sempre a versão mais nova)
  downloadWindows: 'https://github.com/basilfiery/basilfiery/releases/latest/download/BasilFiery-Instalador.exe',

  // Valores de exemplo — ajuste para os seus preços reais
  planos: [
    {
      nome: 'Start',
      preco: 'R$ 149',
      periodo: '/mês',
      descricao: 'Para começar a vender pelo tablet.',
      itens: ['Até 10 mesas', 'Cardápio no tablet', 'Painel de pedidos ao vivo', 'Impressão automática no caixa', 'Aviso no celular do garçom', 'Cardápio em basilfiery.com.br/assinante/sua-loja'],
      destaque: false,
      checkout: '',
    },
    {
      nome: 'Premium',
      preco: 'R$ 249',
      periodo: '/mês',
      descricao: 'Para a casa cheia todos os dias.',
      itens: ['Até 30 mesas', 'Tudo do Start', 'Domínio próprio (suapizzaria.com.br)', 'Controle de estoque', 'Equipe com cargos e permissões', 'Fotos nos pratos'],
      destaque: true,
      checkout: '',
    },
    {
      nome: 'Rede',
      preco: 'Sob consulta',
      periodo: '',
      descricao: 'Para quem tem mais de uma unidade.',
      itens: ['Mesas ilimitadas', 'Tudo do Premium', 'Várias unidades na mesma conta', 'Implantação acompanhada', 'Suporte prioritário'],
      destaque: false,
      checkout: '',
    },
  ],
};

/** Para onde vai o "Assinar agora": checkout da Kirvano ou os planos do site */
export const linkAssinar = () => SITE.checkoutAssinatura || '/#planos';

/** Rodando dentro do programa para Windows */
export const noProgramaWindows = () => typeof window !== 'undefined' && 'basilfieryDesktop' in window;

export function linkWhatsVendas(mensagem = 'Olá! Quero conhecer o BasilFiery para o meu restaurante.') {
  return SITE.whatsappVendas ? `https://wa.me/${SITE.whatsappVendas}?text=${encodeURIComponent(mensagem)}` : null;
}
