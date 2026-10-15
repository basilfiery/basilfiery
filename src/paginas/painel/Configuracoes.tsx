import { useEffect, useRef, useState } from 'react';
import { BellRing, ImagePlus, Printer, Store } from 'lucide-react';
import { Campo, Switch } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { gravarConfigImpressao, imprimirTeste, lerConfigImpressao, type ConfigImpressao } from '../../lib/impressao';
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { definirSom, somLigado, tocarAlerta } from '../../lib/som';
import { enviarImagem, msgErro, supabase } from '../../lib/supabase';
import { cx, ehGestor } from '../../lib/util';
import { usePainel } from './Painel';

const CORES = ['#ff5a1f', '#e63946', '#d6336c', '#7048e8', '#1c7ed6', '#0ca678', '#5c940d', '#f08c00'];

export default function Configuracoes() {
  const { restaurante, papel } = usePainel();
  return (
    <div className="pagina">
      <div className="pagina__cab"><h1 className="titulo">Configurações</h1></div>
      <div className="config-grade">
        {ehGestor(papel) && <CartaoRestaurante key={restaurante.id} />}
        <CartaoImpressora />
        <CartaoNotificacoes />
      </div>
    </div>
  );
}

function CartaoRestaurante() {
  const { restaurante } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(restaurante.nome);
  const [slogan, setSlogan] = useState(restaurante.slogan ?? '');
  const [cor, setCor] = useState(restaurante.cor);
  const [logo, setLogo] = useState(restaurante.logo_url);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.from('restaurantes')
      .update({ nome: nome.trim(), slogan: slogan.trim() || null, cor, logo_url: logo })
      .eq('id', restaurante.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Dados do restaurante salvos.', 'ok');
    void s.recarregar();
  }

  async function enviarLogo(arquivo?: File) {
    if (!arquivo) return;
    try {
      setLogo(await enviarImagem(restaurante.id, arquivo, 'logo'));
    } catch (e) {
      toast(msgErro(e), 'erro');
    }
  }

  return (
    <section className="card">
      <h2 className="card__titulo"><Store size={20} /> Restaurante</h2>
      <div className="form">
        <div className="foto-editor">
          <div className="foto" style={{ width: 72, height: 72, borderRadius: 14, fontSize: 30 }}>
            {logo ? <img src={logo} alt="Logo" /> : <span>{nome.charAt(0)}</span>}
          </div>
          <div className="acoes-linha">
            <button className="btn btn--contorno btn--sm" onClick={() => arquivoRef.current?.click()}><ImagePlus size={16} /> {logo ? 'Trocar logo' : 'Enviar logo'}</button>
            {logo && <button className="btn btn--fantasma btn--sm" onClick={() => setLogo(null)}>Remover</button>}
            <input ref={arquivoRef} className="input-arquivo" type="file" accept="image/*" onChange={(e) => void enviarLogo(e.target.files?.[0])} />
          </div>
        </div>
        <Campo rotulo="Nome do restaurante"><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} /></Campo>
        <Campo rotulo="Frase de boas-vindas (aparece no tablet)"><input className="input" value={slogan} onChange={(e) => setSlogan(e.target.value)} maxLength={100} /></Campo>
        <Campo rotulo="Cor de destaque">
          <div className="cores">
            {CORES.map((c) => (
              <button key={c} type="button" className={cx('cor', cor === c && 'ativo')} style={{ background: c }} onClick={() => setCor(c)} aria-label={`Cor ${c}`} />
            ))}
          </div>
        </Campo>
        <button className="btn btn--primario" disabled={!nome.trim() || salvando} onClick={() => void salvar()}>Salvar</button>
      </div>
    </section>
  );
}

function CartaoImpressora() {
  const { restaurante } = usePainel();
  const [c, setC] = useState<ConfigImpressao>(lerConfigImpressao());
  const mudar = (mudancas: Partial<ConfigImpressao>) => {
    const nova = { ...c, ...mudancas };
    setC(nova);
    gravarConfigImpressao(nova);
  };

  return (
    <section className="card">
      <h2 className="card__titulo"><Printer size={20} /> Impressora deste computador</h2>
      <div className="form">
        <Switch marcado={c.auto} aoMudar={(v) => mudar({ auto: v })}>
          Imprimir pedidos novos automaticamente
        </Switch>
        <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
          Ligue só no computador do caixa que tem a impressora. Cada pedido é impresso uma única vez, mesmo com outros computadores abertos.
        </p>
        <div className="form-linha">
          <Campo rotulo="Largura do papel">
            <select className="select" value={c.largura} onChange={(e) => mudar({ largura: Number(e.target.value) as 58 | 80 })}>
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </select>
          </Campo>
          <Campo rotulo="Vias por pedido">
            <select className="select" value={c.copias} onChange={(e) => mudar({ copias: Number(e.target.value) })}>
              <option value={1}>1 via</option>
              <option value={2}>2 vias (cozinha + garçom)</option>
            </select>
          </Campo>
        </div>
        <button className="btn btn--contorno" onClick={() => imprimirTeste(restaurante.nome)}><Printer size={18} /> Imprimir teste</button>

        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Como imprimir sem a janela de confirmação</summary>
          <ol className="passos-lista" style={{ marginTop: 10 }}>
            <li>No Windows, defina a impressora térmica como <b>impressora padrão</b>.</li>
            <li>Crie um atalho do Google Chrome na área de trabalho.</li>
            <li>Clique com o botão direito → Propriedades → no campo <b>Destino</b>, adicione no final:<br />
              <code>--kiosk-printing {window.location.origin}/painel</code></li>
            <li>Feche todas as janelas do Chrome e abra pelo atalho. Os pedidos saem direto na impressora.</li>
            <li>Nas preferências da impressora, ajuste margens para “nenhuma” se o cupom sair cortado.</li>
          </ol>
        </details>
      </div>
    </section>
  );
}

function CartaoNotificacoes() {
  const { restaurante } = usePainel();
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [som, setSom] = useState(somLigado());
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { void estadoPush().then(setEstado); }, []);

  async function ativar() {
    setOcupado(true);
    try {
      await ativarPush(restaurante.id);
      toast('Notificações ativadas neste aparelho!', 'ok');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(false);
      setEstado(await estadoPush());
    }
  }

  async function desativar() {
    setOcupado(true);
    await desativarPush().catch(() => {});
    setOcupado(false);
    setEstado(await estadoPush());
  }

  const textos: Record<EstadoPush, string> = {
    ativo: 'Ativadas neste aparelho.',
    inativo: 'Desativadas neste aparelho.',
    bloqueado: 'Bloqueadas pelo navegador. Libere nas configurações do site (ícone do cadeado ao lado do endereço).',
    indisponivel: 'Este navegador não suporta notificações.',
    'precisa-instalar': 'No iPhone/iPad, adicione o site à Tela de Início para receber notificações.',
  };

  return (
    <section className="card">
      <h2 className="card__titulo"><BellRing size={20} /> Avisos neste aparelho</h2>
      <div className="form">
        <Switch marcado={som} aoMudar={(v) => { setSom(v); definirSom(v); if (v) tocarAlerta('pedido'); }}>
          Tocar som quando chegar pedido ou chamado
        </Switch>
        <div className="estado-push">
          <span className={cx('badge', estado === 'ativo' ? 'badge--verde' : 'badge--amarelo')}>{estado === 'ativo' ? 'Notificações ligadas' : 'Notificações desligadas'}</span>
        </div>
        {estado && <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>{textos[estado]}</p>}
        {estado === 'ativo' ? (
          <button className="btn btn--contorno" onClick={() => void desativar()} disabled={ocupado}>Desativar neste aparelho</button>
        ) : (
          <button className="btn btn--primario" onClick={() => void ativar()} disabled={ocupado || estado === 'indisponivel'}>Ativar notificações</button>
        )}
        <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
          Para os garçons: abram <b>{window.location.origin}/garcom</b> no celular, entrem com o login deles e toquem em “Ativar notificações”.
        </p>
      </div>
    </section>
  );
}
