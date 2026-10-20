import { Link } from 'react-router-dom';
import { BarChart3, MessageCircle, Share, ShoppingCart, SquarePlus, UserRound } from 'lucide-react';
import { LinkCopiavel, QrCartao } from '../../componentes/Link';
import { usePainel } from './Painel';
import { origemSistema } from '../../lib/linkCurto';
import { linkColaboradores } from './Compras';

/* =====================================================================
   Apps no celular: links prontos para abrir e instalar na tela de início
   ===================================================================== */

export default function AppsCelular() {
  const { restaurante: r } = usePainel();
  const origem = origemSistema();
  const apps = [
    {
      id: 'dono', icone: BarChart3, titulo: 'App do dono', link: `${origem}/dono`,
      texto: 'Vendas ao vivo, relatórios e meta do mês no seu celular. Entra com o mesmo e-mail e senha do sistema.',
      whats: `Meu app de vendas da ${r.nome}: ${origem}/dono`,
    },
    {
      id: 'garcom', icone: UserRound, titulo: 'App do garçom', link: `${origem}/g/${r.codigo}`,
      texto: 'Mesas, pedidos e chamados no celular de cada garçom. Os acessos são criados em Equipe › Garçons.',
      whats: `Olá! Este é o app dos garçons da ${r.nome}: ${origem}/g/${r.codigo}`,
      extra: <Link className="btn btn--fantasma btn--sm" to="/painel/garcons">Criar acesso de garçom</Link>,
    },
    {
      id: 'colab', icone: ShoppingCart, titulo: 'App dos colaboradores', link: linkColaboradores(r.codigo),
      texto: 'Cozinha, bar, limpeza… cada um entra com o usuário e senha que você cria e manda o que precisa repor.',
      whats: `Olá! Este é o app dos colaboradores da ${r.nome}, para mandar o que precisa repor: ${linkColaboradores(r.codigo)}`,
      extra: <Link className="btn btn--fantasma btn--sm" to="/painel/compras?aba=equipe">Criar acesso de colaborador</Link>,
    },
  ];

  return (
    <div className="pagina apps">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Apps no celular</h1>
          <p>Abra o link no celular e instale na tela de início: vira um app, sem precisar de loja de aplicativos.</p>
        </div>
      </div>

      <div className="apps__lista">
        {apps.map((a) => (
          <section key={a.id} className="card app-cartao">
            <div className="app-cartao__corpo">
              <h2 className="card__titulo"><span className="app-cartao__icone"><a.icone size={20} /></span> {a.titulo}</h2>
              <p className="muted">{a.texto}</p>
              <LinkCopiavel link={a.link} />
              <div className="acoes-linha">
                <a className="btn btn--contorno btn--sm" href={`https://wa.me/?text=${encodeURIComponent(a.whats)}`} target="_blank" rel="noopener"><MessageCircle size={15} /> Enviar pelo WhatsApp</a>
                {a.extra}
              </div>
            </div>
            <QrCartao link={a.link} legenda="Aponte a câmera do celular" arquivo={`qr-${a.id}-${r.codigo}`} />
          </section>
        ))}
      </div>

      <section className="card apps__instalar">
        <h2 className="card__titulo">Como instalar na tela de início</h2>
        <div className="apps__passos">
          <div><b>iPhone (Safari)</b><span>Abra o link › toque em <Share size={14} /> Compartilhar › <SquarePlus size={14} /> “Adicionar à Tela de Início”.</span></div>
          <div><b>Android (Chrome)</b><span>Abra o link › toque nos três pontinhos › “Instalar app” ou “Adicionar à tela inicial”.</span></div>
        </div>
      </section>
    </div>
  );
}
