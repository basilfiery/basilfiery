import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock, Globe, Link2, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { confirmar } from '../../componentes/Confirmar';
import { BotaoCopiar, LinkCopiavel } from '../../componentes/Link';
import { useToast } from '../../componentes/Toast';
import { SITE, linkAssinar } from '../../config/site';
import { SLUG_PRINCIPAL, linkLoja, linkMesa, origemSistema, planoPermiteDominio, slugLoja } from '../../lib/linkCurto';
import { useSessao } from '../../lib/sessao';
import { funcao, msgErro, supabase } from '../../lib/supabase';
import { cx } from '../../lib/util';
import { usePainel } from './Painel';

type Registro = { tipo: string; nome: string; valor: string; dominio: string };
type Resposta = { ok: boolean; dominio: string | null; status?: 'pendente' | 'ativo'; registros?: Registro[]; www?: boolean };

const nomePlano = (p?: string | null) =>
  SITE.planos.find((x) => x.nome.toLowerCase() === String(p ?? '').toLowerCase())?.nome ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Sem plano');
const host = (u: string) => u.replace(/^https?:\/\//, '');

/** Domínios: endereço no BasilFiery (todos os planos) e domínio próprio (Premium e Rede). */
export default function Dominios() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const permite = planoPermiteDominio(r.plano) || s.ehAdmin;
  const [info, setInfo] = useState<Resposta | null>(null);
  const [dominio, setDominio] = useState('');
  const [ocupado, setOcupado] = useState<'' | 'conectar' | 'verificar' | 'remover'>('');

  const exemploMesa = { id: 'exemplo', nome: 'Mesa 1', token: '' };
  const semDominio = { ...r, dominio: null };

  const verificar = useCallback(async (avisar = false) => {
    if (!r.dominio) return;
    if (avisar) setOcupado('verificar');
    try {
      const v = await funcao<Resposta>('dominios', 'verificar', { restaurante_id: r.id });
      setInfo(v);
      if (v.status !== r.dominio_status) await s.recarregar();
      if (avisar) toast(v.status === 'ativo' ? 'Domínio conectado! Seu cardápio já abre nele.' : 'Ainda não ficou pronto. Confira os registros e tente daqui a pouco.', v.status === 'ativo' ? 'ok' : 'info');
    } catch (er) { if (avisar) toast(msgErro(er), 'erro'); }
    if (avisar) setOcupado('');
  }, [r.id, r.dominio, r.dominio_status, s, toast]);

  // Pendente: confere sozinho a cada 30 s
  useEffect(() => {
    if (!r.dominio || !permite) return;
    void verificar();
    if (r.dominio_status === 'ativo') return;
    const i = setInterval(() => void verificar(), 30000);
    return () => clearInterval(i);
  }, [r.dominio, r.dominio_status, permite, verificar]);

  async function conectar() {
    if (!dominio.trim()) return toast('Digite o seu domínio.', 'erro');
    setOcupado('conectar');
    try {
      const v = await funcao<Resposta>('dominios', 'adicionar', { restaurante_id: r.id, dominio });
      setInfo(v);
      setDominio('');
      await s.recarregar();
      toast(v.status === 'ativo' ? 'Domínio conectado!' : 'Domínio adicionado. Agora crie os registros abaixo no seu provedor.', 'ok');
    } catch (er) { toast(msgErro(er), 'erro'); }
    setOcupado('');
  }

  async function remover() {
    if (!(await confirmar(`Remover ${r.dominio}?\n\nO cardápio volta a abrir só pelo endereço do BasilFiery. QR codes impressos com o domínio param de funcionar.`, { sim: 'Remover domínio', perigo: true }))) return;
    setOcupado('remover');
    try {
      await funcao('dominios', 'remover', { restaurante_id: r.id });
      setInfo(null);
      await s.recarregar();
      toast('Domínio removido.', 'info');
    } catch (er) { toast(msgErro(er), 'erro'); }
    setOcupado('');
  }

  const registros = info?.registros ?? (r.dominio ? [
    { tipo: 'A', nome: '@', valor: '216.198.79.1', dominio: r.dominio },
    { tipo: 'CNAME', nome: 'www', valor: 'cname.vercel-dns.com', dominio: `www.${r.dominio}` },
  ] : []);
  const ativo = r.dominio_status === 'ativo';

  return (
    <div className="pagina dom">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Domínios</h1>
          <p>Os endereços em que seus clientes abrem o cardápio e as mesas.</p>
        </div>
        <span className={cx('dom-plano', permite && 'dom-plano--premium')}>Plano {nomePlano(r.plano)}</span>
      </div>

      {/* ---------- Endereço no BasilFiery ---------- */}
      <section className="card dom-card">
        <header className="dom-card__cab">
          <span className="dom-card__icone"><Link2 size={20} /></span>
          <div>
            <h2>Endereço no BasilFiery</h2>
            <p>Incluso em todos os planos. Funciona sempre, mesmo com domínio próprio.</p>
          </div>
        </header>
        <div className="dom-links">
          <div><small>Cardápio digital</small><LinkCopiavel link={linkLoja(semDominio)} /></div>
          <div><small>Mesas (exemplo da Mesa 1)</small><LinkCopiavel link={linkMesa(semDominio, exemploMesa)} abrir={false} /></div>
        </div>
        <EnderecoLoja />
      </section>

      {/* ---------- Domínio próprio ---------- */}
      <section className={cx('card dom-card', !permite && 'dom-card--bloqueado')}>
        <header className="dom-card__cab">
          <span className="dom-card__icone"><Globe size={20} /></span>
          <div>
            <h2>Domínio próprio <span className="dom-selo">Premium</span></h2>
            <p>Seu cardápio no seu endereço: <b>suapizzaria.com.br</b> e as mesas em <b>suapizzaria.com.br/mesa1</b>.</p>
          </div>
        </header>

        {!permite ? (
          <div className="dom-bloqueio">
            <span className="dom-bloqueio__icone"><Lock size={22} /></span>
            <div>
              <strong>Disponível no plano Premium</strong>
              <p>No plano {nomePlano(r.plano)} o seu cardápio fica em <b>{host(linkLoja(semDominio))}</b>. Faça o upgrade para usar o seu próprio domínio.</p>
            </div>
            <a className="btn btn--primario" href={linkAssinar()} target={linkAssinar().startsWith('http') ? '_blank' : undefined} rel="noopener">Fazer upgrade <ArrowUpRight size={16} /></a>
          </div>
        ) : !r.dominio ? (
          <>
            <ol className="dom-passos">
              <li><b>1</b> Compre o domínio (Registro.br, Hostinger, GoDaddy…)</li>
              <li><b>2</b> Digite ele aqui e toque em Conectar</li>
              <li><b>3</b> Crie os 2 registros que vamos mostrar no painel do seu provedor</li>
            </ol>
            <form className="dom-conectar" onSubmit={(e) => { e.preventDefault(); void conectar(); }}>
              <label className="dom-conectar__campo">
                <Globe size={18} />
                <input value={dominio} onChange={(e) => setDominio(e.target.value.trim().toLowerCase())} placeholder="suapizzaria.com.br" spellCheck={false} autoCapitalize="none" inputMode="url" aria-label="Seu domínio" />
              </label>
              <button className="btn btn--primario" disabled={!!ocupado || !dominio.includes('.')}>{ocupado === 'conectar' ? 'Conectando…' : 'Conectar domínio'}</button>
            </form>
          </>
        ) : (
          <>
            <div className="dom-atual">
              <div className="dom-atual__nome">
                <Globe size={18} />
                <strong>{r.dominio}</strong>
                <span className={cx('badge', ativo ? 'badge--verde' : 'badge--amarelo')}>
                  {ativo ? <><CheckCircle2 size={13} /> Conectado</> : <><Clock size={13} /> Aguardando DNS</>}
                </span>
              </div>
              <div className="dom-atual__acoes">
                {!ativo && (
                  <button className="btn btn--contorno btn--sm" disabled={!!ocupado} onClick={() => void verificar(true)}>
                    <RefreshCw size={15} className={cx(ocupado === 'verificar' && 'girando')} /> Verificar agora
                  </button>
                )}
                <button className="btn btn--fantasma btn--sm dom-remover" disabled={!!ocupado} onClick={() => void remover()}><Trash2 size={15} /> Remover</button>
              </div>
            </div>

            {ativo ? (
              <div className="dom-links">
                <div><small>Cardápio digital</small><LinkCopiavel link={`https://${r.dominio}`} /></div>
                <div><small>Mesas (exemplo da Mesa 1)</small><LinkCopiavel link={`https://${r.dominio}/mesa1`} abrir={false} /></div>
              </div>
            ) : (
              <div className="dom-dns">
                <p>No painel do seu provedor de domínio, abra a área de <b>DNS</b> e crie estes registros. Se já existir um registro <b>A</b> no <b>@</b>, troque o valor. Depois disso pode levar de alguns minutos até 24 horas. Esta tela confere sozinha.</p>
                <div className="dom-tabela" role="table">
                  <div className="dom-tabela__cab" role="row"><span>Tipo</span><span>Nome</span><span>Valor</span><span /></div>
                  {registros.map((g) => (
                    <div key={g.tipo} className="dom-tabela__linha" role="row">
                      <span><b className="dom-tipo">{g.tipo}</b></span>
                      <span><code>{g.nome}</code></span>
                      <span><code>{g.valor}</code></span>
                      <span><BotaoCopiar texto={g.valor} classe="btn btn--contorno btn--sm" /></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Nome no endereço: basilfiery.com.br/assinante/<nome> */
function EnderecoLoja() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [slug, setSlug] = useState(r.slug);
  const [salvando, setSalvando] = useState(false);
  const limpo = slug.replace(/-+$/, '');
  const alterado = limpo !== r.slug;
  const prefixo = `${host(origemSistema())}/assinante/`;

  if (r.slug === SLUG_PRINCIPAL) {
    return <p className="dom-nota">Esta é a loja principal do sistema: o cardápio fica em <b>{host(origemSistema())}/cardapio</b>.</p>;
  }

  async function salvar() {
    if (limpo.length < 3) return toast('Use pelo menos 3 letras ou números.', 'erro');
    if (!(await confirmar(`Trocar o endereço para ${prefixo}${limpo}?\n\nQR codes e links já divulgados com o endereço antigo param de funcionar.`, { sim: 'Trocar endereço' }))) return;
    setSalvando(true);
    const { error } = await supabase.from('restaurantes').update({ slug: limpo }).eq('id', r.id);
    setSalvando(false);
    if (error) {
      if (error.code === '23505') return toast('Esse nome já é de outra loja. Tente outro.', 'erro');
      if (error.code === '23514') return toast('Esse nome é reservado pelo sistema. Tente outro.', 'erro');
      return toast(msgErro(error), 'erro');
    }
    setSlug(limpo);
    await s.recarregar();
    toast('Endereço atualizado.', 'ok');
  }

  return (
    <div className="dom-slug">
      <small>Nome no endereço</small>
      <div className="cfg-endereco">
        <label className="cfg-endereco__campo">
          <span>{prefixo}</span>
          <input value={slug} maxLength={40} onChange={(e) => setSlug(slugLoja(e.target.value))} placeholder="sua-loja" spellCheck={false} autoCapitalize="none" aria-label="Nome no endereço" />
        </label>
        <button className="btn btn--primario" disabled={!alterado || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
      <p className="dom-nota">O cardápio fica em <b>{prefixo}{limpo || 'sua-loja'}/cardapio</b>.</p>
    </div>
  );
}
