import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChefHat, ChevronUp, LayoutGrid, MessageSquareText, Minus, PencilLine, Plus, Printer, Receipt, Search, ShoppingBasket, Trash2, Wallet, X,
} from 'lucide-react';
import { FotoProduto, Switch } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { IconeForma } from '../../componentes/Pagamento';
import { useToast } from '../../componentes/Toast';
import { imprimirPedido } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { FormaPagamento, Mesa, Pedido } from '../../lib/tipos';
import { brl, cx, lerPreco, mascaraPreco, podeCaixa, precoParaTexto } from '../../lib/util';
import { nomeItem, type CategoriaMesa, type ProdutoMesa, type SaborMesa } from '../mesa/Mesa';
import { mascaraTelefone } from './config/Estabelecimento';
import { usePainel } from './Painel';
import '../../estilos/pdv.css';

/* =====================================================================
   Pedidos balcão (PDV): venda rápida, paga na hora, ou lançamento na mesa.
   Um toque no produto já coloca 1 no pedido.
   ===================================================================== */

interface Dados { categorias: CategoriaMesa[]; produtos: ProdutoMesa[]; sabores?: SaborMesa[]; preparo: string[] }
interface Linha { chave: string; produto_id: string; qtd: number; obs: string }
interface SecaoPdv { id: string; nome: string; principal: string; itens: ProdutoMesa[] }
type Modo = 'balcao' | 'mesa';

const FORMAS: { id: FormaPagamento; rotulo: string }[] = [
  { id: 'pix', rotulo: 'Pix' }, { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'credito', rotulo: 'Crédito' }, { id: 'debito', rotulo: 'Débito' },
];
const digitos = (t: string) => t.replace(/\D/g, '');
const digitando = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** "10%" vira porcentagem do subtotal; "5,00" vira R$ 5,00. */
function lerDesconto(txt: string, subtotal: number) {
  const t = txt.trim();
  if (!t) return 0;
  if (t.endsWith('%')) {
    const p = Number(t.slice(0, -1).replace(',', '.'));
    return Number.isFinite(p) ? Math.round(subtotal * p) / 100 : NaN;
  }
  return lerPreco(t);
}

export default function Pdv() {
  const { restaurante: r, papel, caixa, abrirCaixa } = usePainel();
  const toast = useToast();
  const podeBalcao = podeCaixa(papel);
  const [modo, setModo] = useState<Modo>(podeBalcao ? 'balcao' : 'mesa');
  const [dados, setDados] = useState<Dados | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [busca, setBusca] = useState('');
  const [catAtiva, setCatAtiva] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [obsPedido, setObsPedido] = useState('');
  const [verObs, setVerObs] = useState(false);
  const [desconto, setDesconto] = useState('');
  const [verDesconto, setVerDesconto] = useState(false);
  const [cliTel, setCliTel] = useState('');
  const [cliNome, setCliNome] = useState('');
  const [mesaId, setMesaId] = useState('');
  const [forma, setForma] = useState<FormaPagamento | null>(null);
  const [recebido, setRecebido] = useState('');
  const [cozinhaManual, setCozinhaManual] = useState<boolean | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [concluida, setConcluida] = useState<{ id: string; numero: number; total: number; troco: number | null; forma: FormaPagamento | null } | null>(null);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('pdv_cardapio', { p_rest: r.id });
    if (error) return toast(msgErro(error), 'erro');
    setDados(data as Dados);
  }, [r.id, toast]);
  useEffect(() => {
    void carregar();
    void supabase.from('mesas').select('*').eq('restaurante_id', r.id).eq('ativo', true).order('ordem')
      .then(({ data }) => setMesas((data ?? []) as Mesa[]));
    const i = setInterval(() => void carregar(), 60000);
    return () => clearInterval(i);
  }, [carregar, r.id]);

  // Mesmo cálculo do cardápio: preço de subcategoria e sabores dentro de cada tamanho
  const { secoes, porId, principais } = useMemo(() => {
    const cats = dados?.categorias ?? [];
    const porCat = new Map(cats.map((c) => [c.id, c]));
    const produtos = (dados?.produtos ?? []).map((p) => {
      const c = porCat.get(p.categoria_id);
      return c?.preco_grupo != null ? { ...p, preco: Number(c.preco_grupo) + Number(p.preco), prefixo: c.nome } : p;
    });
    const sabores = (c: CategoriaMesa): ProdutoMesa[] => (c.grupo_id ? (dados?.sabores ?? []).filter((x) => x.grupo_id === c.grupo_id).map((x) => ({
      ...x, id: `${c.id}:${x.id}`, categoria_id: c.id, disponivel: x.disponivel && !c.esgotado,
      preco: Number(c.preco_grupo ?? 0) + Number(x.preco), real_id: x.id, tamanho_id: c.id, prefixo: c.nome,
    })) : []);
    const itensDe = (c: CategoriaMesa) => [...sabores(c), ...produtos.filter((p) => p.categoria_id === c.id)];
    const principais = cats.filter((c) => !c.pai_id || !porCat.has(c.pai_id));
    const secoes: SecaoPdv[] = [];
    for (const c of principais) {
      const diretos = itensDe(c);
      if (diretos.length) secoes.push({ id: c.id, nome: c.nome, principal: c.id, itens: diretos });
      for (const sub of cats.filter((x) => x.pai_id === c.id)) {
        const itens = itensDe(sub);
        if (itens.length) secoes.push({ id: sub.id, nome: `${c.nome} › ${sub.nome}`, principal: c.id, itens });
      }
    }
    const porId = new Map(secoes.flatMap((sec) => sec.itens).map((p) => [p.id, p]));
    return { secoes, porId, principais: principais.filter((c) => secoes.some((sec) => sec.principal === c.id)) };
  }, [dados]);

  const termo = busca.trim().toLowerCase();
  const resultados = useMemo(() => (termo ? [...porId.values()].filter((p) => nomeItem(p).toLowerCase().includes(termo)) : []), [termo, porId]);

  const subtotal = linhas.reduce((s, l) => s + (porId.get(l.produto_id)?.preco ?? 0) * l.qtd, 0);
  const valorDesconto = lerDesconto(desconto, subtotal);
  const descontoOk = Number.isFinite(valorDesconto) && valorDesconto >= 0 && valorDesconto <= subtotal;
  const total = Math.max(0, subtotal - (descontoOk ? valorDesconto : 0));
  const valorRecebido = recebido.trim() ? lerPreco(recebido) : NaN;
  const troco = forma === 'dinheiro' && Number.isFinite(valorRecebido) ? valorRecebido - total : null;
  const qtdItens = linhas.reduce((s, l) => s + l.qtd, 0);
  const precisaCozinha = linhas.some((l) => dados?.preparo.includes(porId.get(l.produto_id)?.real_id ?? l.produto_id));
  const cozinha = cozinhaManual ?? precisaCozinha;
  const qtdNoPedido = (id: string) => linhas.filter((l) => l.produto_id === id).reduce((s, l) => s + l.qtd, 0);

  function adicionar(p: ProdutoMesa) {
    if (!p.disponivel) return;
    const max = p.estoque_max ?? 99;
    if (qtdNoPedido(p.id) >= max) return toast(`Só tem ${max} de ${nomeItem(p)} no estoque.`, 'erro');
    const chave = `${p.id}|`;
    setLinhas((l) => (l.some((x) => x.chave === chave)
      ? l.map((x) => (x.chave === chave ? { ...x, qtd: x.qtd + 1 } : x))
      : [...l, { chave, produto_id: p.id, qtd: 1, obs: '' }]));
  }
  const mudarQtd = (chave: string, qtd: number) =>
    setLinhas((l) => (qtd <= 0 ? l.filter((x) => x.chave !== chave) : l.map((x) => (x.chave === chave ? { ...x, qtd: Math.min(qtd, 99) } : x))));
  const mudarObs = (chave: string, obs: string) =>
    setLinhas((l) => l.map((x) => (x.chave === chave ? { ...x, obs, chave: `${x.produto_id}|${obs}` } : x)));

  function limpar() {
    setLinhas([]); setObsPedido(''); setVerObs(false); setDesconto(''); setVerDesconto(false);
    setCliTel(''); setCliNome(''); setForma(null); setRecebido(''); setCozinhaManual(null); setEditando(null);
    setFolhaAberta(false);
  }

  const motivoBloqueio =
    !linhas.length ? 'Adicione itens'
      : !descontoOk ? 'Desconto inválido'
        : modo === 'mesa' && !mesaId ? 'Escolha a mesa'
          : modo === 'balcao' && caixa === null ? 'Abra o caixa'
            : modo === 'balcao' && !forma ? 'Escolha o pagamento'
              : modo === 'balcao' && forma === 'dinheiro' && troco !== null && troco < 0 ? 'Valor recebido menor'
                : cliTel && digitos(cliTel).length < 10 ? 'WhatsApp com DDD'
                  : '';

  async function gerar() {
    if (motivoBloqueio || enviando) {
      if (motivoBloqueio) toast(`${motivoBloqueio}.`, 'erro');
      return;
    }
    setEnviando(true);
    const { data, error } = await supabase.rpc('pdv_vender', {
      p_rest: r.id,
      p_itens: linhas.map((l) => {
        const p = porId.get(l.produto_id);
        return { produto_id: p?.real_id ?? l.produto_id, categoria_id: p?.tamanho_id ?? null, qtd: l.qtd, obs: l.obs };
      }),
      p_dados: {
        modo, mesa_id: modo === 'mesa' ? mesaId : null, forma: modo === 'balcao' ? forma : null,
        recebido: forma === 'dinheiro' && Number.isFinite(valorRecebido) ? String(valorRecebido) : '',
        desconto: valorDesconto > 0 ? String(valorDesconto) : '', cozinha, obs: obsPedido,
        cliente_nome: cliNome, cliente_telefone: digitos(cliTel),
      },
    });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    const v = data as { id: string; numero: number; total: number; troco: number | null };
    if (modo === 'mesa') toast(`Pedido #${v.numero} lançado na ${mesas.find((m) => m.id === mesaId)?.nome ?? 'mesa'}.`, 'ok');
    else setConcluida({ ...v, forma });
    limpar();
    void carregar();
  }

  async function imprimirCupom(id: string) {
    const { data } = await supabase.from('pedidos').select('*, pedido_itens(*)').eq('id', id).single();
    if (data) imprimirPedido(data as Pedido, r.nome);
  }

  // Atalhos: P (ou /) pesquisa, Ctrl+Enter gera o pedido, Esc limpa a busca
  const gerarRef = useRef(gerar);
  gerarRef.current = gerar;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-fundo')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void gerarRef.current(); return; }
      if (digitando(e.target)) return;
      if (e.key === 'p' || e.key === 'P' || e.key === '/') { e.preventDefault(); buscaRef.current?.focus(); }
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

  function irPara(id: string) {
    setCatAtiva(id);
    setBusca('');
    requestAnimationFrame(() => listaRef.current?.querySelector(`[data-principal="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // Categoria em destaque acompanha a rolagem
  useEffect(() => {
    const raiz = listaRef.current;
    if (!raiz || termo) return;
    const obs = new IntersectionObserver((ent) => {
      const vis = ent.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setCatAtiva((vis.target as HTMLElement).dataset.principal ?? '');
    }, { root: raiz, rootMargin: '0px 0px -70% 0px' });
    raiz.querySelectorAll('[data-principal]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [secoes, termo]);

  const cartao = (p: ProdutoMesa) => {
    const n = qtdNoPedido(p.id);
    return (
      <button key={p.id} type="button" className={cx('pdv-prod', !p.disponivel && 'esgotado', n > 0 && 'no-pedido')} disabled={!p.disponivel} onClick={() => adicionar(p)} title={nomeItem(p)}>
        <span className="pdv-prod__foto">
          <FotoProduto p={p} classe="pdv-prod__img" />
          {!p.disponivel && <em>Esgotado</em>}
          {n > 0 && <b>{n}</b>}
        </span>
        <span className="pdv-prod__nome">{p.nome}</span>
        <span className="pdv-prod__preco">{brl(p.preco)}</span>
      </button>
    );
  };

  const pedido = (
    <div className="pdv-pedido">
      <header className="pdv-pedido__cab">
        <strong><Receipt size={17} /> Itens do pedido {qtdItens > 0 && <small>{qtdItens}</small>}</strong>
        {linhas.length > 0 && <button type="button" className="btn btn--fantasma btn--sm" onClick={limpar}><Trash2 size={15} /> Limpar</button>}
        <button type="button" className="icone-btn pdv-pedido__fechar" onClick={() => setFolhaAberta(false)} aria-label="Fechar"><X size={18} /></button>
      </header>

      <div className="pdv-pedido__itens">
        {linhas.length === 0 ? (
          <div className="pdv-pedido__vazio"><ShoppingBasket size={34} strokeWidth={1.5} /><p>Toque nos produtos ao lado.<br />Eles aparecem aqui.</p></div>
        ) : linhas.map((l) => {
          const p = porId.get(l.produto_id);
          if (!p) return null;
          return (
            <div key={l.chave} className="pdv-linha">
              <div className="pdv-linha__qtd">
                <button type="button" onClick={() => mudarQtd(l.chave, l.qtd - 1)} aria-label="Menos">{l.qtd === 1 ? <Trash2 size={14} /> : <Minus size={14} />}</button>
                <span>{l.qtd}</span>
                <button type="button" onClick={() => mudarQtd(l.chave, l.qtd + 1)} aria-label="Mais" disabled={p.estoque_max != null && qtdNoPedido(p.id) >= p.estoque_max}><Plus size={14} /></button>
              </div>
              <div className="pdv-linha__info">
                <strong>{nomeItem(p)}</strong>
                {editando === l.chave ? (
                  <input
                    className="input pdv-linha__obs-input"
                    autoFocus
                    maxLength={140}
                    defaultValue={l.obs}
                    placeholder="Ex.: sem gelo"
                    onBlur={(e) => { mudarObs(l.chave, e.target.value.trim()); setEditando(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                  />
                ) : (
                  <button type="button" className="pdv-linha__obs" onClick={() => setEditando(l.chave)}>
                    <PencilLine size={12} /> {l.obs ? `“${l.obs}”` : 'Observação'}
                  </button>
                )}
              </div>
              <span className="pdv-linha__preco">{brl(p.preco * l.qtd)}</span>
            </div>
          );
        })}
      </div>

      <div className="pdv-pedido__rodape">
        <div className="pdv-extras">
          <button type="button" className={cx('pdv-chip', (verObs || obsPedido) && 'ativo')} onClick={() => setVerObs((v) => !v)}><MessageSquareText size={14} /> Observação</button>
          <button type="button" className={cx('pdv-chip', (verDesconto || desconto) && 'ativo')} onClick={() => setVerDesconto((v) => !v)} disabled={!podeBalcao}><Wallet size={14} /> Desconto</button>
        </div>
        {(verObs || obsPedido) && <textarea className="textarea pdv-obs" rows={2} maxLength={300} value={obsPedido} onChange={(e) => setObsPedido(e.target.value)} placeholder="Observação do pedido" />}

        <div className="pdv-totais">
          <div><span>Subtotal</span><span>{brl(subtotal)}</span></div>
          {(verDesconto || desconto) && (
            <div className="pdv-totais__desconto">
              <span>Desconto</span>
              <input className={cx('input', !descontoOk && 'input--erro')} value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="R$ ou %" inputMode="decimal" aria-label="Desconto em reais ou porcentagem" />
              {descontoOk && valorDesconto > 0 && <em>− {brl(valorDesconto)}</em>}
            </div>
          )}
          <div className="pdv-totais__total"><span>Total</span><strong>{brl(total)}</strong></div>
        </div>

        <div className="pdv-cliente">
          <input className="input" inputMode="tel" value={mascaraTelefone(cliTel)} onChange={(e) => setCliTel(digitos(e.target.value))} placeholder="WhatsApp (opcional)" aria-label="WhatsApp do cliente" />
          <input className="input" value={cliNome} maxLength={80} onChange={(e) => setCliNome(e.target.value)} placeholder="Nome do cliente" aria-label="Nome do cliente" />
        </div>

        {modo === 'mesa' ? (
          <select className="select" value={mesaId} onChange={(e) => setMesaId(e.target.value)} aria-label="Mesa">
            <option value="">Escolha a mesa…</option>
            {mesas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        ) : (
          <>
            <div className="pdv-formas" role="radiogroup" aria-label="Forma de pagamento">
              {FORMAS.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={forma === f.id} className={cx('pdv-forma', forma === f.id && 'ativo')} onClick={() => setForma(f.id)}>
                  <IconeForma forma={f.id} tamanho={17} />
                  <span>{f.rotulo}</span>
                </button>
              ))}
            </div>
            {forma === 'dinheiro' && (
              <div className="pdv-troco">
                <input className="input" inputMode="decimal" value={recebido} onChange={(e) => setRecebido(mascaraPreco(e.target.value))} placeholder="Valor recebido" aria-label="Valor recebido" />
                <div className="pdv-troco__atalhos">
                  {[...new Set([Math.ceil(total), Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, 100])].filter((v) => v >= total && v > 0).slice(0, 3).map((v) => (
                    <button key={v} type="button" className="pdv-chip" onClick={() => setRecebido(precoParaTexto(v))}>{brl(v)}</button>
                  ))}
                </div>
                {troco !== null && <p className={cx('pdv-troco__valor', troco < 0 && 'falta')}>{troco < 0 ? `Faltam ${brl(-troco)}` : `Troco: ${brl(troco)}`}</p>}
              </div>
            )}
          </>
        )}

        <div className="pdv-cozinha">
          <Switch marcado={cozinha} aoMudar={setCozinhaManual}>
            <span><ChefHat size={15} /> Enviar para a cozinha</span>
          </Switch>
          {modo === 'balcao' && <small>{cozinha ? 'Vai para Pedidos e imprime na cozinha.' : 'Entregue na hora: a venda já fica concluída.'}</small>}
        </div>

      </div>
      <div className="pdv-pedido__acao">
        <button type="button" className="btn btn--primario btn--lg btn--bloco pdv-gerar" disabled={!!motivoBloqueio || enviando} onClick={() => void gerar()}>
          {enviando ? 'Gerando…' : motivoBloqueio || (modo === 'mesa' ? `Lançar na mesa · ${brl(total)}` : `Gerar pedido · ${brl(total)}`)}
          <kbd>Ctrl + Enter</kbd>
        </button>
      </div>
    </div>
  );

  return (
    <div className="pdv">
      <header className="pdv__cab">
        <h1>Pedidos balcão (PDV)</h1>
        <div className="pdv__modos" role="tablist">
          <button role="tab" aria-selected={modo === 'balcao'} className={cx(modo === 'balcao' && 'ativo')} disabled={!podeBalcao} onClick={() => setModo('balcao')}>
            <ShoppingBasket size={17} /> Balcão <span>venda rápida</span>
          </button>
          <button role="tab" aria-selected={modo === 'mesa'} className={cx(modo === 'mesa' && 'ativo')} onClick={() => setModo('mesa')}>
            <LayoutGrid size={17} /> Mesas <span>lançar na conta</span>
          </button>
        </div>
      </header>

      {modo === 'balcao' && caixa === null && (
        <div className="pdv__aviso">
          <Wallet size={18} />
          <span><b>O caixa está fechado.</b> Abra o caixa para receber as vendas do balcão.</span>
          <button className="btn btn--primario btn--sm" onClick={abrirCaixa}>Abrir caixa</button>
        </div>
      )}

      <div className="pdv__corpo">
        <section className="pdv__catalogo">
          <label className="pdv__busca">
            <Search size={18} />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setBusca(''); (e.target as HTMLInputElement).blur(); }
                if (e.key === 'Enter' && resultados[0]) { adicionar(resultados[0]); setBusca(''); }
              }}
              placeholder="Pesquisar produto"
            />
            <kbd>P</kbd>
          </label>

          <div className="pdv__area">
            <nav className="pdv__cats" aria-label="Categorias">
              {principais.map((c) => (
                <button key={c.id} type="button" className={cx('pdv-cat', !termo && catAtiva === c.id && 'ativa')} onClick={() => irPara(c.id)}>{c.nome}</button>
              ))}
            </nav>
            <div className="pdv__lista" ref={listaRef}>
              {!dados ? <div className="spinner" style={{ margin: '60px auto' }} /> : termo ? (
                resultados.length ? (
                  <section className="pdv-secao">
                    <h2>Resultados para “{busca.trim()}” <small>Enter adiciona o primeiro</small></h2>
                    <div className="pdv-grade">{resultados.map(cartao)}</div>
                  </section>
                ) : <p className="vazio">Nenhum produto com “{busca.trim()}”.</p>
              ) : secoes.length === 0 ? (
                <p className="vazio">Cadastre produtos no Gestor de cardápio para vender aqui.</p>
              ) : secoes.map((sec, i) => (
                <section key={sec.id} className="pdv-secao" {...(secoes.findIndex((x) => x.principal === sec.principal) === i ? { 'data-principal': sec.principal } : {})}>
                  <h2>{sec.nome}</h2>
                  <div className="pdv-grade">{sec.itens.map(cartao)}</div>
                </section>
              ))}
            </div>
          </div>
        </section>

        <aside className={cx('pdv__pedido', folhaAberta && 'aberta')}>{pedido}</aside>
        {folhaAberta && <div className="pdv__fundo" onClick={() => setFolhaAberta(false)} aria-hidden="true" />}
      </div>

      {/* Celular/tablet em pé: barra que abre o pedido */}
      <button type="button" className={cx('pdv__barra', qtdItens > 0 && 'com-itens')} onClick={() => setFolhaAberta(true)}>
        <span className="pdv__barra-qtd">{qtdItens}</span>
        <span>Ver pedido</span>
        <strong>{brl(total)}</strong>
        <ChevronUp size={18} />
      </button>

      {concluida && (
        <Modal aberto aoFechar={() => setConcluida(null)} largura={400} classe="pdv-ok">
          <div className="pdv-ok__corpo">
            <span className="pdv-ok__icone"><Check size={34} strokeWidth={3} /></span>
            <h2>Venda concluída</h2>
            <p>Pedido <b>#{concluida.numero}</b> · {brl(Number(concluida.total))}{concluida.forma ? ` no ${FORMAS.find((f) => f.id === concluida.forma)?.rotulo}` : ''}</p>
            {concluida.troco != null && Number(concluida.troco) > 0 && <p className="pdv-ok__troco">Troco: <b>{brl(Number(concluida.troco))}</b></p>}
            <div className="pdv-ok__acoes">
              <button className="btn btn--contorno btn--lg" onClick={() => void imprimirCupom(concluida.id)}><Printer size={18} /> Imprimir cupom</button>
              <button className="btn btn--primario btn--lg" autoFocus onClick={() => { setConcluida(null); buscaRef.current?.focus(); }}>Nova venda</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
