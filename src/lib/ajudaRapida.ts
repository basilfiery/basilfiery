/* Funil de ajuda rápida do suporte: o cliente escolhe o assunto e vê os passos que resolvem
   a maioria dos casos. Se não resolver, segue para o assistente (e daí para uma pessoa). */

export interface TopicoAjuda {
  id: string;
  emoji: string;
  titulo: string;
  passos: string[];
  /** Frase enviada ao chat quando o cliente diz que não resolveu */
  pergunta: string;
}

export const TOPICOS_AJUDA: TopicoAjuda[] = [
  {
    id: 'impressora', emoji: '🖨️', titulo: 'A impressora não imprime',
    passos: [
      'Abra o programa BasilFiery no computador do caixa (o site no navegador não imprime sozinho).',
      'Vá em Configurações › Impressora, escolha a impressora e ligue “Imprimir automaticamente”.',
      'Confira se o caixa está aberto (botão Caixa no topo).',
      'Toque em “Imprimir teste”. Se não sair: veja cabo USB, papel e se a impressora está ligada.',
    ],
    pergunta: 'A impressora não imprime. Já conferi programa aberto, impressora escolhida e caixa aberto.',
  },
  {
    id: 'avisos', emoji: '🔔', titulo: 'Não toca som / pedido não aparece',
    passos: [
      'Confira se o ícone de som no topo do painel está ligado.',
      'Em Configurações › Avisos e sons, toque em ativar notificações e permita no navegador.',
      'Deixe o painel aberto (pode ficar minimizado). No celular, use o app instalado.',
      'Veja se a internet está funcionando: o “Ao vivo” verde aparece em Pedidos.',
    ],
    pergunta: 'Os pedidos não estão avisando com som / não aparecem no painel.',
  },
  {
    id: 'mesa', emoji: '📱', titulo: 'Cliente da mesa não consegue pedir',
    passos: [
      'Depois de escanear o QR code, o celular do cliente precisa ser LIBERADO pela equipe.',
      'Aparece “quer fazer pedidos” no topo do painel e no app do garçom: toque em Liberar.',
      'No app do garçom, em Mesas › tocar na mesa, o QR code aparece para o cliente escanear.',
      'Tablet que fica na mesa: use “Liberar sempre” (tablet fixo).',
    ],
    pergunta: 'O cliente da mesa escaneou o QR code e não consegue fazer o pedido.',
  },
  {
    id: 'cardapio', emoji: '🍕', titulo: 'Cardápio, preços e fotos',
    passos: [
      'Edite tudo em Gestor de cardápio › Itens e categorias.',
      'Item com preço R$ 0,00 fica indisponível. Para pausar, use “Esgotado”.',
      'Para enquadrar a foto, use o botão “Ajustar imagem”.',
      'As mudanças aparecem no cardápio em até 1 minuto.',
    ],
    pergunta: 'Preciso de ajuda com o cardápio (itens, preços ou fotos).',
  },
  {
    id: 'delivery', emoji: '🛵', titulo: 'Delivery fechado ou taxa errada',
    passos: [
      'Confira o horário em Configurações › Estabelecimento › Horários.',
      'Veja se o cardápio digital está ativado em Configurações › Cardápio digital.',
      'Taxa e pedido mínimo ficam em Estabelecimento › Taxa de entrega / Pedido mínimo.',
    ],
    pergunta: 'Meu delivery está com problema (aparece fechado ou a taxa está errada).',
  },
  {
    id: 'fatura', emoji: '💳', titulo: 'Fatura e plano',
    passos: [
      'Veja e pague em Minha conta › Fatura.',
      'Depois do vencimento há 5 dias de tolerância antes de bloquear.',
      'Pagou e continua bloqueado? Fale com uma pessoa do time aqui mesmo.',
    ],
    pergunta: 'Tenho uma dúvida sobre a minha fatura/plano.',
  },
];
