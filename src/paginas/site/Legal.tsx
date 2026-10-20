import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ShieldCheck } from 'lucide-react';
import { SITE } from '../../config/site';
import '../../estilos/legal.css';

/* =====================================================================
   Termos de Uso (/termos) e Política de Privacidade (/privacidade)
   Públicos: servem para anúncios (Meta, Google), lojas de apps e clientes.
   ===================================================================== */

const ATUALIZADO = '19 de outubro de 2026';
const EMAIL = SITE.emailContato;
const SITE_URL = SITE.dominio;

function Pagina({ tipo, titulo, resumo, secoes }: { tipo: 'termos' | 'privacidade'; titulo: string; resumo: ReactNode; secoes: { id: string; titulo: string; corpo: ReactNode }[] }) {
  useEffect(() => {
    const antes = document.title;
    document.title = `${titulo} · ${SITE.marca}`;
    window.scrollTo(0, 0);
    return () => { document.title = antes; };
  }, [titulo]);
  return (
    <div className="legal">
      <header className="legal-topo">
        <Link to="/" className="legal-marca"><img src="/icone-192.png" alt="" /><span>Basil<b>Fiery</b></span></Link>
        <nav>
          <Link to="/termos" className={tipo === 'termos' ? 'ativo' : ''}>Termos de uso</Link>
          <Link to="/privacidade" className={tipo === 'privacidade' ? 'ativo' : ''}>Privacidade</Link>
        </nav>
      </header>
      <main className="legal-corpo">
        <div className="legal-cab">
          <span className="legal-cab__icone">{tipo === 'termos' ? <FileText size={26} /> : <ShieldCheck size={26} />}</span>
          <h1>{titulo}</h1>
          <p className="legal-data">Atualizado em {ATUALIZADO}</p>
          <div className="legal-resumo">{resumo}</div>
        </div>
        <nav className="legal-indice" aria-label="Nesta página">
          <strong>Nesta página</strong>
          <ol>{secoes.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.titulo}</a></li>)}</ol>
        </nav>
        {secoes.map((s, i) => (
          <section key={s.id} id={s.id} className="legal-secao">
            <h2><span>{i + 1}.</span> {s.titulo}</h2>
            {s.corpo}
          </section>
        ))}
        <footer className="legal-rodape">
          <p>Dúvidas? Escreva para <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>
          <p><Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Política de privacidade</Link> · <Link to="/">{SITE.marca}</Link></p>
        </footer>
      </main>
    </div>
  );
}

export function Termos() {
  return (
    <Pagina
      tipo="termos"
      titulo="Termos de Uso"
      resumo={<p>Estes termos explicam as regras para usar o {SITE.marca}: o sistema de gestão para restaurantes e os cardápios digitais (na mesa e para delivery). Ao usar qualquer parte da plataforma, você concorda com eles.</p>}
      secoes={[
        { id: 'quem-somos', titulo: 'Quem somos e o que oferecemos', corpo: <>
          <p>O {SITE.marca} é uma plataforma de tecnologia para restaurantes, bares, pizzarias e lanchonetes. Ela reúne o painel de gestão (pedidos, mesas, caixa, estoque, cardápio, relatórios e equipe), o cardápio na mesa (tablet ou QR code), o cardápio digital para delivery e retirada, o app do garçom, o app do dono e o programa para Windows que imprime os pedidos.</p>
          <p>Estes termos valem para todo mundo que usa a plataforma, acessando em <a href={SITE_URL}>{SITE_URL.replace('https://', '')}</a> ou pelos aplicativos.</p>
        </>},
        { id: 'definicoes', titulo: 'Definições', corpo: <ul>
          <li><b>Plataforma:</b> o {SITE.marca}, com todos os seus sites, painéis e aplicativos.</li>
          <li><b>Estabelecimento:</b> o restaurante ou comércio que contrata a Plataforma para vender e organizar o seu negócio.</li>
          <li><b>Equipe:</b> as pessoas que o Estabelecimento cadastra para usar o painel (dono, gerente, caixa, garçom e colaboradores).</li>
          <li><b>Consumidor:</b> quem acessa o cardápio de um Estabelecimento para ver produtos e fazer pedidos.</li>
        </ul> },
        { id: 'contas', titulo: 'Cadastro, contas e senhas', corpo: <>
          <p>Para contratar a Plataforma é preciso ter 18 anos ou mais e informar dados verdadeiros. O Estabelecimento é responsável pelas contas da sua Equipe, pelas permissões que dá a cada pessoa e por tudo o que for feito com elas.</p>
          <p>A senha é pessoal. Não compartilhe e avise a gente se suspeitar de uso indevido. Cada pessoa sai da conta só no aparelho em que clicou em “Sair”.</p>
          <p>O Consumidor pode pedir sem criar conta. Se preferir criar uma conta (com e-mail e senha ou com o Google), poderá acompanhar os seus pedidos, salvar endereços e pedir de novo.</p>
        </>},
        { id: 'pedidos', titulo: 'Pedidos feitos pelo cardápio', corpo: <>
          <p>O {SITE.marca} é uma <b>intermediária de tecnologia</b>: leva o pedido do Consumidor até o Estabelecimento. Quem vende, prepara, entrega e recebe o pagamento é sempre o <b>Estabelecimento</b>.</p>
          <p>Por isso, preços, promoções, disponibilidade, ingredientes, tempo de preparo e de entrega, taxa de entrega, troco, formas de pagamento, cancelamentos, trocas e o atendimento ao Consumidor são de responsabilidade do Estabelecimento, que deve cumprir o Código de Defesa do Consumidor e as demais leis.</p>
          <p>O Estabelecimento pode cancelar um pedido ou um item (por exemplo, quando um produto acaba). Nesses casos, o Consumidor é avisado na tela com o motivo. Pagamentos não são processados pela Plataforma: são feitos diretamente com o Estabelecimento (Pix, dinheiro ou cartão na entrega, na retirada ou na mesa).</p>
          <p>Os cupons impressos pelo sistema não são documento fiscal. A emissão de nota ou cupom fiscal é obrigação do Estabelecimento.</p>
        </>},
        { id: 'planos', titulo: 'Planos, pagamentos e cancelamento', corpo: <>
          <p>A Plataforma é oferecida em planos mensais, com os valores e recursos informados na contratação. Não há fidelidade: o Estabelecimento pode cancelar quando quiser, e o acesso continua até o fim do período já pago.</p>
          <p>Em caso de falta de pagamento, o acesso pode ser suspenso até a regularização. Os preços podem ser reajustados, sempre com aviso de pelo menos 30 dias.</p>
        </>},
        { id: 'responsabilidades', titulo: 'Responsabilidades do Estabelecimento', corpo: <ul>
          <li>Manter o cardápio correto: nomes, descrições, fotos, preços, alergênicos e informações nutricionais quando exigidas.</li>
          <li>Ter o direito de usar as fotos, vídeos, marcas e textos que publica.</li>
          <li>Cumprir as normas sanitárias, fiscais, trabalhistas e de proteção ao consumidor.</li>
          <li>Tratar os dados dos seus clientes conforme a Lei Geral de Proteção de Dados (LGPD) e usar os dados apenas para atender os pedidos e o relacionamento permitido por lei.</li>
          <li>Usar o Pixel da Meta, o Google Analytics, o Google Ads ou outras ferramentas de anúncio de acordo com as regras dessas empresas e com a LGPD.</li>
          <li>Manter seus aparelhos, internet e impressoras funcionando.</li>
        </ul> },
        { id: 'proibido', titulo: 'O que não é permitido', corpo: <ul>
          <li>Usar a Plataforma para atividades ilegais, fraudes, golpes ou venda de produtos proibidos.</li>
          <li>Enviar spam, conteúdo ofensivo, discriminatório, falso ou que viole direitos de terceiros.</li>
          <li>Tentar invadir, copiar, desmontar, sobrecarregar ou burlar a segurança da Plataforma, ou acessar dados de outros estabelecimentos.</li>
          <li>Criar pedidos falsos ou usar robôs para fazer pedidos.</li>
        </ul> },
        { id: 'propriedade', titulo: 'Propriedade intelectual', corpo: <>
          <p>O {SITE.marca}, sua marca, layout, código e funcionalidades pertencem aos seus titulares e são protegidos por lei. O contrato dá ao Estabelecimento o direito de usar a Plataforma, sem transferir a propriedade.</p>
          <p>O conteúdo do Estabelecimento (cardápio, fotos, logo) continua sendo dele. Ele nos autoriza a guardar e exibir esse conteúdo apenas para fazer a Plataforma funcionar.</p>
        </>},
        { id: 'disponibilidade', titulo: 'Disponibilidade e suporte', corpo: <>
          <p>Trabalhamos para que a Plataforma funcione 24 horas por dia, mas podem ocorrer manutenções, atualizações e falhas de terceiros (internet, provedores de nuvem, energia, aparelhos e impressoras). Sempre que possível, avisamos com antecedência.</p>
          <p>O suporte é feito pelos canais informados no site e no painel.</p>
        </>},
        { id: 'limitacao', titulo: 'Limitação de responsabilidade', corpo: <>
          <p>A Plataforma não responde pela qualidade, pela entrega ou pelo preço dos produtos dos Estabelecimentos, nem por decisões tomadas pelo Estabelecimento ou pela sua Equipe.</p>
          <p>Na relação com o Estabelecimento, a responsabilidade do {SITE.marca} por eventuais danos fica limitada ao valor pago nos 12 meses anteriores ao fato, e não inclui lucros cessantes ou danos indiretos. Nada aqui afasta direitos que a lei garante ao consumidor.</p>
        </>},
        { id: 'encerramento', titulo: 'Suspensão e encerramento', corpo: <p>Podemos suspender ou encerrar contas que descumprirem estes termos ou a lei, ou que coloquem em risco a segurança da Plataforma e de outros usuários. Ao final do contrato, o Estabelecimento pode pedir uma cópia dos seus dados em até 30 dias; depois disso, os dados podem ser apagados, menos o que a lei obriga a guardar.</p> },
        { id: 'privacidade', titulo: 'Privacidade', corpo: <p>O uso de dados pessoais segue a nossa <Link to="/privacidade">Política de Privacidade</Link>, que faz parte destes termos.</p> },
        { id: 'mudancas', titulo: 'Mudanças nestes termos', corpo: <p>Podemos atualizar estes termos para refletir melhorias ou mudanças na lei. A data no topo mostra a versão em vigor. Mudanças importantes serão avisadas no painel ou por e-mail.</p> },
        { id: 'lei', titulo: 'Lei aplicável e foro', corpo: <p>Estes termos seguem as leis do Brasil. Nas relações de consumo, vale o foro do domicílio do consumidor. Nos demais casos, as partes escolhem o foro do domicílio do Estabelecimento contratante.</p> },
        { id: 'contato', titulo: 'Contato', corpo: <p>Fale com a gente pelo e-mail <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p> },
      ]}
    />
  );
}

export function Privacidade() {
  return (
    <Pagina
      tipo="privacidade"
      titulo="Política de Privacidade"
      resumo={<>
        <p>Esta política explica quais dados pessoais o {SITE.marca} trata, para quê, com quem compartilha e como você exerce os seus direitos, de acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, a LGPD) e o Marco Civil da Internet.</p>
        <ul className="legal-destaques">
          <li>Não vendemos dados pessoais.</li>
          <li>Não guardamos dados de cartão: o pagamento é feito direto com o restaurante.</li>
          <li>Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento.</li>
        </ul>
      </>}
      secoes={[
        { id: 'papeis', titulo: 'Quem cuida dos seus dados', corpo: <>
          <p><b>Dados dos clientes de um restaurante</b> (quem faz pedidos pelo cardápio): o restaurante é o <b>controlador</b>, ou seja, decide como usar esses dados para atender o pedido. O {SITE.marca} é o <b>operador</b>: guarda e processa os dados em nome do restaurante.</p>
          <p><b>Dados das contas na Plataforma</b> (donos, equipes e consumidores que criam conta): o {SITE.marca} é o controlador.</p>
        </>},
        { id: 'dados', titulo: 'Quais dados coletamos', corpo: <>
          <h3>Restaurantes e equipes</h3>
          <ul>
            <li>Nome, e-mail, telefone/WhatsApp, foto de perfil e cargo.</li>
            <li>Dados do estabelecimento: nome, CNPJ ou CPF, razão social, endereço, horários, cardápio, fotos e configurações.</li>
            <li>Registros de uso e de acesso (data, hora e endereço IP), como exige o Marco Civil da Internet.</li>
          </ul>
          <h3>Consumidores que fazem pedidos</h3>
          <ul>
            <li>Nome, WhatsApp, endereço de entrega e ponto de referência.</li>
            <li>Localização do aparelho, <b>somente se você tocar em “Minha localização”</b> e autorizar, para calcular a taxa de entrega.</li>
            <li>Itens pedidos, observações, forma de pagamento e valor para troco.</li>
            <li>No programa de fidelidade: o telefone e a quantidade de pedidos.</li>
            <li>Se criar uma conta: e-mail, senha (guardada de forma criptografada, que ninguém consegue ler) e, ao entrar com o Google, o nome, o e-mail e a foto da sua conta Google; também os endereços salvos e o histórico de pedidos.</li>
          </ul>
          <h3>Cardápio na mesa</h3>
          <ul><li>Um código aleatório do aparelho, usado só para o garçom liberar a mesa. Ele não identifica a pessoa.</li></ul>
          <h3>Dados técnicos</h3>
          <ul><li>Tipo de aparelho e navegador, e informações guardadas no próprio aparelho (sacola, sessão e preferências).</li></ul>
        </>},
        { id: 'finalidades', titulo: 'Para que usamos e com qual base legal', corpo: <ul>
          <li><b>Receber, preparar, entregar e acompanhar pedidos</b>, e avisar sobre cancelamentos: execução de contrato (art. 7º, V).</li>
          <li><b>Criar e manter contas</b>, dar suporte e enviar comunicações sobre o serviço: execução de contrato.</li>
          <li><b>Segurança</b>, prevenção de fraudes e melhoria da Plataforma com dados agregados: legítimo interesse (art. 7º, IX).</li>
          <li><b>Guardar registros de acesso</b> e cumprir obrigações fiscais: obrigação legal (art. 7º, II).</li>
          <li><b>Relatórios do restaurante</b> (vendas, produtos mais vendidos, clientes que mais compram): legítimo interesse do restaurante, sempre dentro do relacionamento com o cliente.</li>
          <li><b>Anúncios e medição</b>, quando o restaurante ativa ferramentas de anúncio: veja o item “Cookies e anúncios”.</li>
        </ul> },
        { id: 'cookies', titulo: 'Cookies, armazenamento no aparelho e anúncios', corpo: <>
          <p>Usamos o armazenamento do navegador para coisas essenciais: manter você conectado, guardar a sacola e lembrar preferências. Sem isso, o sistema não funciona.</p>
          <p>Cada restaurante pode ativar, no seu cardápio digital, o <b>Pixel da Meta</b> (Facebook e Instagram), o <b>Google Analytics 4</b> e o <b>Google Ads</b>. Essas ferramentas podem usar cookies e registrar eventos de navegação, como ver o cardápio, adicionar à sacola, iniciar o pedido e concluir a compra (com o valor do pedido), para medir e direcionar anúncios. <b>O {SITE.marca} não envia nome, telefone, e-mail ou endereço a essas ferramentas.</b></p>
          <p>O tratamento feito por elas segue as políticas da <a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noopener">Meta</a> e do <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google</a>. Você pode limitar anúncios personalizados nas configurações dessas empresas (<a href="https://www.facebook.com/adpreferences" target="_blank" rel="noopener">preferências de anúncios da Meta</a>, <a href="https://myadcenter.google.com" target="_blank" rel="noopener">Minha Central de Anúncios do Google</a>) e bloquear ou apagar cookies no seu navegador.</p>
        </>},
        { id: 'compartilhamento', titulo: 'Com quem compartilhamos', corpo: <>
          <ul>
            <li><b>Com o restaurante</b> em que você faz o pedido, que precisa dos dados para atender você.</li>
            <li><b>Com fornecedores de tecnologia</b> que fazem a Plataforma funcionar: Supabase (banco de dados, login e arquivos) e Vercel (hospedagem do site).</li>
            <li><b>Com o Google</b>, se você escolher entrar com a sua conta Google.</li>
            <li><b>Com o OpenStreetMap (Nominatim)</b>, que recebe o texto do endereço digitado para encontrá-lo no mapa e calcular a entrega.</li>
            <li><b>Com o WhatsApp</b>, quando você ou o restaurante tocam em um link para conversar.</li>
            <li><b>Com autoridades</b>, quando houver ordem judicial ou obrigação legal.</li>
          </ul>
          <p>Não vendemos nem alugamos dados pessoais.</p>
        </>},
        { id: 'internacional', titulo: 'Transferência internacional', corpo: <p>Alguns fornecedores guardam dados em servidores fora do Brasil (por exemplo, nos Estados Unidos). Nesses casos, a transferência segue o art. 33 da LGPD, com fornecedores que adotam padrões de segurança e proteção adequados.</p> },
        { id: 'seguranca', titulo: 'Segurança', corpo: <p>Usamos conexão criptografada (HTTPS), senhas protegidas por criptografia, regras no banco de dados que separam os dados de cada restaurante e acesso por cargos dentro da equipe. Nenhum sistema é 100% invulnerável, mas, se acontecer um incidente com risco relevante, avisaremos os afetados e a Autoridade Nacional de Proteção de Dados (ANPD), como manda a lei.</p> },
        { id: 'retencao', titulo: 'Por quanto tempo guardamos', corpo: <ul>
          <li>Dados da conta: enquanto ela existir.</li>
          <li>Pedidos: pelo tempo necessário ao histórico do restaurante e às obrigações fiscais e contábeis (em geral, até 5 anos).</li>
          <li>Registros de acesso: 6 meses, como exige o Marco Civil da Internet.</li>
          <li>Depois desses prazos, os dados são apagados ou anonimizados.</li>
        </ul> },
        { id: 'direitos', titulo: 'Seus direitos', corpo: <>
          <p>Pela LGPD (art. 18), você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre com quem compartilhamos, revogação do consentimento e revisão de decisões automatizadas. Também pode reclamar à ANPD.</p>
          <p>Para exercer seus direitos, escreva para <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. Se o pedido for sobre os dados de um restaurante específico, você também pode falar direto com ele. Respondemos em até 15 dias.</p>
        </>},
        { id: 'excluir', titulo: 'Como excluir sua conta e seus dados', corpo: <p>Envie um e-mail para <a href={`mailto:${EMAIL}`}>{EMAIL}</a> com o assunto “Excluir meus dados”, informando o e-mail da conta ou o telefone usado nos pedidos. Apagamos a conta e os dados pessoais em até 15 dias, mantendo apenas o que a lei obriga a guardar.</p> },
        { id: 'menores', titulo: 'Crianças e adolescentes', corpo: <p>A Plataforma não é voltada a menores de 18 anos. Pedidos feitos por menores devem ter a autorização dos pais ou responsáveis.</p> },
        { id: 'encarregado', titulo: 'Encarregado de dados (DPO)', corpo: <p>O contato do encarregado pelo tratamento de dados pessoais é <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p> },
        { id: 'mudancas', titulo: 'Mudanças nesta política', corpo: <p>Esta política pode ser atualizada. A data no topo mostra a versão em vigor, e mudanças importantes serão avisadas na Plataforma.</p> },
      ]}
    />
  );
}

export default Termos;
