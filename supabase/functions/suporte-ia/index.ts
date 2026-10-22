// Assistente virtual do suporte (Claude). Responde no chat do painel e, quando precisa,
// passa a conversa para uma pessoa do time (ferramenta "chamar_humano").
//   POST { restaurante_id }  (Authorization: token do usuário da loja)
// Segredos: ANTHROPIC_API_KEY (obrigatório), CLAUDE_MODELO (opcional)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const MODELO = Deno.env.get('CLAUDE_MODELO') || 'claude-sonnet-5-5';
const NOME_IA = 'Assistente BasilFiery';

const SISTEMA = `Você é o assistente virtual de suporte do BasilFiery, um sistema brasileiro para restaurantes (cardápio digital em tablet/QR code na mesa, delivery, PDV, painel de pedidos, caixa, impressão, app do garçom e app do dono).
Quem fala com você é a equipe de um restaurante cliente (dono, gerente, caixa ou garçom), dentro do painel do sistema.

COMO RESPONDER
- Português do Brasil, tom simpático e direto, frases curtas. Nada de textão: no máximo uns 6 passos curtos por resposta.
- Diga o caminho exato no sistema usando "›" (ex.: Configurações › Impressora).
- Faça no máximo uma pergunta por vez quando faltar informação.
- Nunca invente função que não existe. Se não souber, diga que vai chamar alguém do time.
- Não peça senha, CPF/CNPJ completo nem dados de cartão.
- Use a ferramenta chamar_humano quando: o cliente pedir para falar com uma pessoa; for cobrança/estorno/cancelamento de assinatura; parecer erro/bug do sistema; o sistema estiver fora do ar ou travando em horário de venda; perda de pedidos ou dinheiro; ou depois de 2 tentativas sem resolver. Ao chamar, escreva antes uma frase curta avisando que vai passar para o time.
- Você não ouve áudios. Se o cliente mandar áudio, peça para escrever em poucas palavras ou ofereça chamar uma pessoa.

O QUE O SISTEMA FAZ (use para orientar)
- Menu lateral do painel: Pedidos, Pedidos balcão (PDV), Mesas, Gestor de cardápio (Itens e categorias, Aparência do cardápio), Notas fiscais, Estoque, Lista de compras, Alavancar vendas, Relatórios (Visão geral, Itens, Mesas e comandas), Apps no celular, Garçons, Equipe, Minha conta (Geral, Informações pessoais, Formas de pagamento, Fatura), Configurações (Meus clientes, Meus pedidos, Impressora, Integrações, Cardápio digital, Estabelecimento, Nota fiscal, Integração de anúncios, Aparência, Domínios, Avisos e sons).
- Pedidos: quadro com Novos, Em preparo, Prontos, Entregues. Botão "Novo pedido". Som e aviso no canto da tela quando chega pedido (Configurações › Avisos e sons › ativar notificações; ícone de som no topo precisa estar ligado).
- Impressão: precisa do programa BasilFiery para Windows aberto no computador do caixa (baixar em Apps no celular / site). Em Configurações › Impressora escolha a impressora, ligue "Imprimir automaticamente" e use "Imprimir teste". O caixa precisa estar aberto para imprimir automático. Confira cabo USB, papel e se a impressora aparece no Windows.
- Mesas: cada mesa tem link e QR code (Mesas › tocar na mesa). O cliente escaneia o QR e só consegue pedir depois que alguém da equipe LIBERA o aparelho (aparece "quer fazer pedidos" no topo do painel e no app do garçom → Liberar). Tablet que fica na mesa: "Tablet fixo"/"Liberar sempre". Fechar a conta (Mesas › mesa › forma de pagamento) libera a mesa e desconecta os celulares. Precisa de caixa aberto para receber.
- App do garçom: basilfiery.com.br/appgarcom (login com e-mail e senha do garçom cadastrado em Garçons). Mostra pedidos prontos para levar, chamados das mesas, e na aba Mesas o QR code de cada mesa para o cliente escanear e liberar na hora.
- Cardápio: Gestor de cardápio › Itens e categorias para criar/editar itens, preços, fotos (botão "Ajustar imagem"), adicionais (grupos com mínimo/máximo), subcategorias, marcar esgotado. Item com preço R$ 0,00 fica indisponível. Mudanças aparecem no cardápio em até 1 minuto. Configurações › Cardápio digital: ligar/desligar, observação, mostrar esgotados em cinza ou ocultar.
- Delivery: link em Configurações › Cardápio digital. Horários em Configurações › Estabelecimento › Horários (fora do horário a loja aparece fechada). Taxa (fixa, por bairro ou por distância) e pedido mínimo em Estabelecimento. Formas de pagamento em Estabelecimento › Pagamento na entrega.
- PDV: venda no balcão; precisa de caixa aberto. Caixa: botão Caixa no topo (abrir, retirada, suprimento, fechar).
- Alavancar vendas: order bump — oferta que aparece no cardápio depois que o cliente escolhe um item (com desconto opcional, por categoria, item, palavras-chave ou automático).
- Relatórios: vendas, itens mais vendidos, mesas e comandas, lucro (com custo dos produtos).
- Equipe e Garçons: cadastrar pessoas com cargo (dono, gerente, caixa, garçom).
- Apps no celular: app do dono (basilfiery.com.br/dono) com vendas e meta do mês; app do garçom.
- Fatura: Minha conta › Fatura. Há tolerância de 5 dias depois do vencimento antes de bloquear. Problemas de cobrança: chamar humano.
- Domínio próprio (planos Premium/Rede): Configurações › Domínios.
- Atualização: quando aparece "Nova versão", clicar em Atualizar (não perde nada).`;

const FERRAMENTAS = [{
  name: 'chamar_humano',
  description: 'Passa a conversa para uma pessoa do time de suporte do BasilFiery. Use quando precisar de um humano (pedido do cliente, cobrança, bug, sistema fora do ar, ou depois de 2 tentativas sem resolver).',
  input_schema: { type: 'object', properties: { motivo: { type: 'string', description: 'Resumo curto do problema para o atendente' } }, required: ['motivo'] },
}];

interface Msg { id: string; do_suporte: boolean; ia: boolean; texto: string; tipo: string; anexo: string | null; duracao: number | null; meta: Record<string, unknown> | null; criado_em: string }
type Bloco = { type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const chave = Deno.env.get('ANTHROPIC_API_KEY');
    if (!chave) return json({ ok: false, motivo: 'sem_chave' });

    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token ?? '');
    if (!u?.user) return json({ erro: 'Faça login novamente.' }, 401);
    const { restaurante_id: rest } = await req.json();
    const [{ data: membro }, { data: adm }] = await Promise.all([
      admin.from('membros').select('papel, nome').eq('user_id', u.user.id).eq('restaurante_id', rest).maybeSingle(),
      admin.from('plataforma_admins').select('user_id').eq('user_id', u.user.id).maybeSingle(),
    ]);
    if (!membro && !adm) return json({ erro: 'Sem acesso' }, 403);

    const { data: estado } = await admin.from('suporte_estado').select('modo').eq('restaurante_id', rest).maybeSingle();
    if (estado?.modo === 'humano') return json({ ok: true, humano: true });

    // Limite: muitas respostas em pouco tempo → passa para o time
    const { count } = await admin.from('suporte_mensagens').select('id', { count: 'exact', head: true })
      .eq('restaurante_id', rest).eq('ia', true).gte('criado_em', new Date(Date.now() - 3600_000).toISOString());

    const { data: brutas } = await admin.from('suporte_mensagens').select('id, do_suporte, ia, texto, tipo, anexo, duracao, meta, criado_em')
      .eq('restaurante_id', rest).order('criado_em', { ascending: false }).limit(30);
    let msgs = ((brutas ?? []) as Msg[]).reverse();
    // Só o atendimento atual (depois do último "finalizado")
    const fim = msgs.map((m) => m.meta?.acao).lastIndexOf('finalizado');
    if (fim >= 0) msgs = msgs.slice(fim + 1);
    const ultima = msgs[msgs.length - 1];
    if (!ultima || ultima.do_suporte) return json({ ok: true });

    if ((count ?? 0) >= 40) {
      await passarParaHumano(rest, 'Muitas mensagens com o assistente na última hora', 'Vou chamar alguém do nosso time para continuar com você, tá bem? 🙂');
      return json({ ok: true, humano: true });
    }

    // Monta a conversa (cliente = user, suporte/assistente = assistant)
    const conversa: { role: 'user' | 'assistant'; content: Bloco[] }[] = [];
    for (const [i, m] of msgs.entries()) {
      if (m.tipo === 'sistema' && m.meta?.acao !== 'pediu_humano') continue;
      const papel = m.do_suporte ? 'assistant' : 'user';
      const blocos: Bloco[] = [];
      if (m.tipo === 'imagem' && m.anexo) {
        if (!m.do_suporte && i >= msgs.length - 4) {
          const { data: s } = await admin.storage.from('suporte').createSignedUrl(m.anexo, 600);
          if (s?.signedUrl) blocos.push({ type: 'image', source: { type: 'url', url: s.signedUrl } });
        }
        blocos.push({ type: 'text', text: m.texto?.trim() ? m.texto : '[enviou uma imagem]' });
      } else if (m.tipo === 'audio') {
        blocos.push({ type: 'text', text: `[enviou um áudio de ${m.duracao ?? 0} segundos — você não consegue ouvir]` });
      } else if (m.tipo === 'sistema') {
        blocos.push({ type: 'text', text: '[o cliente pediu para falar com uma pessoa]' });
      } else {
        blocos.push({ type: 'text', text: (m.do_suporte && !m.ia ? '(resposta de uma pessoa do time) ' : '') + m.texto });
      }
      const ant = conversa[conversa.length - 1];
      if (ant && ant.role === papel) ant.content.push(...blocos);
      else conversa.push({ role: papel, content: blocos });
    }
    while (conversa.length && conversa[0].role !== 'user') conversa.shift();
    if (!conversa.length || conversa[conversa.length - 1].role !== 'user') return json({ ok: true });

    const { data: loja } = await admin.from('restaurantes').select('nome, plano, segmento').eq('id', rest).maybeSingle();
    const contexto = `\n\nCLIENTE ATUAL: loja "${loja?.nome ?? ''}"${loja?.segmento ? ` (${loja.segmento})` : ''}, plano ${loja?.plano ?? '—'}. Quem escreve: ${membro?.nome || 'equipe da loja'}${membro?.papel ? ` (${membro.papel})` : ''}.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODELO, max_tokens: 800, system: SISTEMA + contexto, tools: FERRAMENTAS, messages: conversa }),
    });
    const resp = await r.json();
    if (!r.ok) {
      console.error('anthropic', r.status, JSON.stringify(resp));
      return json({ ok: false, motivo: 'erro_ia' });
    }
    const texto = (resp.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim();
    const chamar = (resp.content ?? []).find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'chamar_humano');

    if (chamar) {
      await passarParaHumano(rest, String(chamar.input?.motivo ?? 'Precisa de ajuda do time'),
        texto || 'Vou chamar alguém do nosso time para te ajudar com isso. Já já uma pessoa responde por aqui. 🙂');
      return json({ ok: true, humano: true });
    }
    if (texto) {
      await admin.from('suporte_mensagens').insert({ restaurante_id: rest, autor_nome: NOME_IA, do_suporte: true, ia: true, texto: texto.slice(0, 4000), tipo: 'texto' });
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, erro: String(e) }, 500);
  }
});

async function passarParaHumano(rest: string, motivo: string, aviso: string) {
  await admin.from('suporte_mensagens').insert({ restaurante_id: rest, autor_nome: NOME_IA, do_suporte: true, ia: true, texto: aviso.slice(0, 4000), tipo: 'texto' });
  await admin.from('suporte_mensagens').insert({
    restaurante_id: rest, autor_nome: NOME_IA, do_suporte: true, ia: true, texto: `Assistente chamou o time: ${motivo}`.slice(0, 400),
    tipo: 'sistema', meta: { acao: 'ia_chamou_humano', motivo },
  });
  await admin.from('suporte_estado').upsert({ restaurante_id: rest, modo: 'humano', pedido_humano_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
}
