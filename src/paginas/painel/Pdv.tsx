import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bike, Check, ChefHat, ChevronUp, Gift, LayoutGrid, MessageSquareText, Minus, Pencil, PencilLine, Plus, Printer, Receipt, Search, ShoppingBasket, Trash2, UserRound, Wallet, X,
} from 'lucide-react';
import { FotoProduto, Switch } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { IconeForma } from '../../componentes/Pagamento';
import { useToast } from '../../componentes/Toast';
import { imprimirPedido } from '../../lib/impressao';
import { msgErro, supabase, rpcSeguro } from '../../lib/supabase';
import type { FormaPagamento, Mesa, Pedido } from '../../lib/tipos';
import { brl, cx, lerPreco, mascaraPreco, podeCaixa, precoParaTexto } from '../../lib/util';
import { ModalProduto, juntarNoCarrinho, nomeItem, precoLinha, type AdicionaisEscolhidos, type CategoriaMesa, type Linha, type ProdutoMesa, type SaborMesa } from '../mesa/Mesa';
import { gruposDoProduto, type GrupoAdicionalMesa, type RegrasProduto } from '../../lib/adicionais';
import { mascaraTelefone } from './config/Estabelecimento';
import { usePainel } from './Painel';
import '../../estilos/mesa.css';
import '../../estilos/pdv.css';

/* =====================================================================
   Pedidos balcão (PDV): venda rápida, paga na hora, ou lançamento na mesa.
   Um toque no produto já coloca 1 no pedido.
   ===================================================================== */

interface Dados {
  categorias: CategoriaMesa[]; produtos: ProdutoMesa[]; sabores?: SaborMesa[]; preparo: string[];
  adicionais_grupos?: GrupoAdicionalMesa[]; produto_grupos?: Record<string, string[]>; produto_regras?: RegrasProduto;
}
interface SecaoPdv { id: string; nome: string; principal: string; itens: ProdutoMesa[] }
type Modo = 'balcao' | 'mesa' | 'entrega';
interface EnderecoPdv { rua: string; numero: string; bairro: string; complemento: string; referencia: string }
const END_VAZIO: EnderecoPdv = { rua: '', numero: '', bairro: '', complemento: '', referencia: '' };

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

/**
 * `mesaFixa`: aberto pela tela de Mesas (clicou na mesa). Lança direto na conta dela,
 * com o cabeçalho da mesa no lugar das abas Balcão/Mesas.
 */
/** Nome e WhatsApp do cliente salvos na mesa: aparecem no cartão da mesa e no app do garçom. */
function ClienteMesa({ mesa, aoSalvar }: { mesa: Mesa; aoSalvar: () => void }) {
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(mesa.cliente_nome ?? '');
  const [tel, setTel] = useState(mesa.cliente_telefone ?? '');
  const [salvando, setSalvando] = useState(false);
  const salvo = { nome: mesa.cliente_nome ?? '', tel: mesa.cliente_telefone ?? '' };
  const mudou = nome.trim() !== salvo.nome || digitos(tel) !== salvo.tel;
  const telInvalido = !!tel && digitos(tel).length < 10;

  function abrir() { setNome(salvo.nome); setTel(salvo.tel); setEditando(true); }
  async function salvar() {
    if (telInvalido) return toast('WhatsApp com DDD (ex.: 11 99999-9999).', 'erro');
    setSalvando(true);
    const { error } = await supabase.rpc('mesa_definir_cliente', { p_mesa: mesa.id, p_nome: nome.trim(), p_telefone: digitos(tel) });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(nome.trim() || tel ? `Cliente salvo na ${mesa.nome}.` : 'Cliente removido da mesa.', 'ok');
    setEditando(false);
    aoSalvar();
  }

  if (editando) {
    return (
      <div className="pdv-cliente-mesa pdv-cliente-mesa--editar">
        <span className="pdv-cliente-mesa__tit"><UserRound size={15} /> Cliente da mesa</span>
        <div className="pdv-cliente">
          <input className={cx('input', telInvalido && 'input--erro')} inputMode="tel" value={mascaraTelefone(tel)} onChange={(e) => setTel(digitos(e.target.value))} placeholder="WhatsApp (opcional)" aria-label="WhatsApp do cliente" />
          <input className="input" value={nome} maxLength={80} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" aria-label="Nome do cliente"
            onKeyDown={(e) => { if (e.key === 'Enter') void salvar(); }} />
        </div>
        <div className="pdv-obs-editar__acoes">
          <button type="button" className="btn btn--fantasma btn--sm" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</button>
          <button type="button" className="btn btn--primario btn--sm" onClick={() => void salvar()} disabled={salvando || !mudou}><Check size={15} /> {salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    );
  }
  if (!salvo.nome && !salvo.tel) {
    return <button type="button" className="pdv-cliente-mesa__add" onClick={abrir}><UserRound size={16} /> Colocar nome ou WhatsApp do cliente</button>;
  }
  return (
    <div className="pdv-cliente-mesa">
      <span className="pdv-cliente-mesa__icone"><UserRound size={17} /></span>
      <span className="pdv-cliente-mesa__dados">
        <b>{salvo.nome || 'Cliente'}</b>
        {salvo.tel && <small>{mascaraTelefone(salvo.tel)}</small>}
      </span>
      <button type="button" className="btn btn--fantasma btn--sm" onClick={abrir}><PencilLine size={14} /> Editar</button>
    </div>
  );
}

export interface AbaConta { aba: 'pedido' | 'conta'; aoAba: (a: 'pedido' | 'conta') => void; total: number; painel: ReactNode }

export default function Pdv({ mesaFixa, cabecalho, aoLancar, conta }: { mesaFixa?: Mesa; cabecalho?: ReactNode; aoLancar?: () => void; conta?: AbaConta } = {}) {
  const { restaurante: r, papel, caixa, abrirCaixa } = usePainel();
  const toast = useToast();
  const podeBalcao = podeCaixa(papel);
  const mesaDaUrl = mesaFixa?.id ?? new URLSearchParams(window.location.search).get('mesa') ?? '';
  const [modo, setModo] = useState<Modo>(mesaDaUrl || !podeBalcao ? 'mesa' : 'balcao');
  const [dados, setDados] = useState<Dados | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [busca, setBusca] = useState('');
  const [catAtiva, setCatAtiva] = useState('');
  const [subAtiva, setSubAtiva] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [obsPedido, setObsPedido] = useState('');
  const [verObs, setVerObs] = useState(false);
  const [rascunhoObs, setRascunhoObs] = useState('');
  const [desconto, setDesconto] = useState('');
  const [verDesconto, setVerDesconto] = useState(false);
  const [cliTel, setCliTel] = useState('');
  const [cliNome, setCliNome] = useState('');
  const [mesaId, setMesaId] = useState(mesaDaUrl);
  const [forma, setForma] = useState<FormaPagamento | null>(null);
  const [recebido, setRecebido] = useState('');
  const [cozinhaManual, setCozinhaManual] = useState<boolean | null>(null);
  // Entrega feita pelo balcão (cliente pediu na loja para receber em casa)
  const [end, setEnd] = useState<EnderecoPdv>(END_VAZIO);
  const [taxaTxt, setTaxaTxt] = useState('');
  const [taxaManual, setTaxaManual] = useState(false);
  const [freteDia, setFreteDia] = useState(false);
  const [freteCats, setFreteCats] = useState<string[]>([]);
  const [freteManual, setFreteManual] = useState<boolean | null>(null);
  const [pagoAgora, setPagoAgora] = useState(false);
  const [corridaFixa, setCorridaFixa] = useState<number | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [concluida, setConcluida] = useState<{ id: string; numero: number; total: number; troco: number | null; forma: FormaPagamento | null } | null>(null);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [escolhendo, setEscolhendo] = useState<ProdutoMesa | null>(null);
  const [editandoItem, setEditandoItem] = useState<Linha | null>(null);
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
      if (diretos.length) secoes.push({ id: c.id, nome: cats.some((x) => x.pai_id === c.id) ? 'Outros' : c.nome, principal: c.id, itens: diretos });
      for (const sub of cats.filter((x) => x.pai_id === c.id)) {
        const itens = itensDe(sub);
        if (itens.length) secoes.push({ id: sub.id, nome: sub.nome, principal: c.id, itens });
      }
    }
    const porId = new Map(secoes.flatMap((sec) => sec.itens).map((p) => [p.id, p]));
    return { secoes, porId, principais: principais.filter((c) => secoes.some((sec) => sec.principal === c.id)) };
  }, [dados]);

  const termo = busca.trim().toLowerCase();
  const resultados = useMemo(() => (termo ? [...porId.values()].filter((p) => nomeItem(p).toLowerCase().includes(termo)) : []), [termo, porId]);

  const subtotal = linhas.reduce((s, l) => s + precoLinha(l, porId.get(l.produto_id)) * l.qtd, 0);
  const valorDesconto = lerDesconto(desconto, subtotal);
  const descontoOk = Number.isFinite(valorDesconto) && valorDesconto >= 0 && valorDesconto <= subtotal;
  const itensComDesconto = Math.max(0, subtotal - (descontoOk ? valorDesconto : 0));
  const taxaEntrega = modo === 'entrega' && taxaTxt.trim() ? lerPreco(taxaTxt) : 0;
  const taxaOk = modo !== 'entrega' || (taxaTxt.trim() !== '' && Number.isFinite(taxaEntrega) && taxaEntrega >= 0);
  // Frete grátis do dia: só se tiver item das categorias da promoção (ex.: pizza)
  const freteHoje = freteDia && (!freteCats.length || linhas.some((l) => freteCats.includes(porId.get(l.produto_id)?.categoria_id ?? '')));
  const freteGratis = modo === 'entrega' && (freteManual ?? freteHoje);
  const total = itensComDesconto + (modo === 'entrega' && !freteGratis && Number.isFinite(taxaEntrega) ? taxaEntrega : 0);
  const cobraAgora = modo === 'balcao' || (modo === 'entrega' && pagoAgora);
  const valorRecebido = recebido.trim() ? lerPreco(recebido) : NaN;
  const troco = forma === 'dinheiro' && Number.isFinite(valorRecebido) ? valorRecebido - total : null;
  const qtdItens = linhas.reduce((s, l) => s + l.qtd, 0);
  const precisaCozinha = linhas.some((l) => dados?.preparo.includes(porId.get(l.produto_id)?.real_id ?? l.produto_id));
  const cozinha = cozinhaManual ?? (modo === 'entrega' ? true : precisaCozinha);

  // Entrega: taxa pelo bairro (bairro cadastrado ou taxa fixa) e se hoje é dia de frete grátis
  useEffect(() => {
    if (modo !== 'entrega') return;
    const t = setTimeout(() => {
      void supabase.rpc('pdv_taxa_entrega', { p_rest: r.id, p_bairro: end.bairro.trim(), p_itens: itensComDesconto }).then(({ data }) => {
        const x = data as { taxa: number | null; frete_gratis: boolean; frete_categorias?: string[] | null; corrida_fixa: number | null } | null;
        if (!x) return;
        setFreteDia(!!x.frete_gratis);
        setFreteCats(x.frete_categorias ?? []);
        setCorridaFixa(x.corrida_fixa != null ? Number(x.corrida_fixa) : null);
        if (!taxaManual && x.taxa != null) setTaxaTxt(precoParaTexto(Number(x.taxa)));
      });
    }, 350);
    return () => clearTimeout(t);
  }, [modo, end.bairro, itensComDesconto, r.id, taxaManual]);
  const qtdNoPedido = (id: string) => linhas.filter((l) => l.produto_id === id).reduce((s, l) => s + l.qtd, 0);

  const gruposDe = (p: ProdutoMesa) => gruposDoProduto(p.real_id ?? p.id, dados?.adicionais_grupos, dados?.produto_grupos, dados?.produto_regras);

  // Um toque já coloca 1; se o item tem adicionais (ex.: sabores), abre a escolha
  function adicionar(p: ProdutoMesa, qtd = 1, obs = '', a?: AdicionaisEscolhidos) {
    if (!p.disponivel) return;
    const max = p.estoque_max ?? 99;
    if (qtdNoPedido(p.id) + qtd > max) return toast(`Só tem ${max} de ${nomeItem(p)} no estoque.`, 'erro');
    conta?.aoAba('pedido');
    if (!a && gruposDe(p).length) return setEscolhendo(p);
    setLinhas((l) => juntarNoCarrinho(l, p, qtd, obs, a));
  }
  const mudarQtd = (chave: string, qtd: number) =>
    setLinhas((l) => (qtd <= 0 ? l.filter((x) => x.chave !== chave) : l.map((x) => (x.chave === chave ? { ...x, qtd: Math.min(qtd, 99) } : x))));
  // Editar um item do pedido: troca a linha no mesmo lugar (se ficar igual a outra, soma nela)
  function salvarEdicao(antiga: Linha, p: ProdutoMesa, qtd: number, obs: string, a?: AdicionaisEscolhidos) {
    setLinhas((l) => {
      const i = l.findIndex((x) => x.chave === antiga.chave);
      const sem = l.filter((x) => x.chave !== antiga.chave);
      const junto = juntarNoCarrinho(sem, p, qtd, obs, a);
      if (junto.length === sem.length || i < 0) return junto; // somou numa linha igual
      const nova = junto[junto.length - 1];
      return [...sem.slice(0, i), nova, ...sem.slice(i)];
    });
    toast(`${nomeItem(p)} atualizado.`, 'ok');
  }
  const mudarObs = (chave: string, obs: string) =>
    setLinhas((l) => l.map((x) => (x.chave === chave ? { ...x, obs, chave: `${x.produto_id}|${obs}|${x.chave.split('|')[2] ?? ''}` } : x)));

  function limpar() {
    setLinhas([]); setObsPedido(''); setVerObs(false); setDesconto(''); setVerDesconto(false);
    setCliTel(''); setCliNome(''); setForma(null); setRecebido(''); setCozinhaManual(null); setEditando(null);
    setEnd(END_VAZIO); setTaxaTxt(''); setTaxaManual(false); setFreteManual(null); setPagoAgora(false);
    setFolhaAberta(false);
  }

  const motivoBloqueio =
    !linhas.length ? 'Adicione itens'
      : !descontoOk ? 'Desconto inválido'
        : modo === 'mesa' && !mesaId ? 'Escolha a mesa'
          : modo === 'entrega' && !cliNome.trim() ? 'Nome do cliente'
          : modo === 'entrega' && digitos(cliTel).length < 10 ? 'WhatsApp do cliente'
          : modo === 'entrega' && (!end.rua.trim() || !end.numero.trim() || !end.bairro.trim()) ? 'Endereço da entrega'
          : !taxaOk ? 'Taxa de entrega'
          : cobraAgora && caixa === null ? 'Abra o caixa'
            : cobraAgora && !forma ? 'Escolha o pagamento'
              : cobraAgora && forma === 'dinheiro' && troco !== null && troco < 0 ? 'Valor recebido menor'
                : cliTel && digitos(cliTel).length < 10 ? 'WhatsApp com DDD'
                  : '';

  async function gerar() {
    if (motivoBloqueio || enviando) {
      if (motivoBloqueio) toast(`${motivoBloqueio}.`, 'erro');
      return;
    }
    setEnviando(true);
    const { data, error } = await rpcSeguro(supabase, 'pdv_vender', {
      p_rest: r.id,
      p_itens: linhas.map((l) => {
        const p = porId.get(l.produto_id);
        return { produto_id: p?.real_id ?? l.produto_id, categoria_id: p?.tamanho_id ?? null, qtd: l.qtd, obs: l.obs, adicionais: l.adicionais ?? [] };
      }),
      p_dados: {
        modo, mesa_id: modo === 'mesa' ? mesaId : null, forma: modo === 'mesa' ? null : forma,
        ...(modo === 'entrega' ? {
          endereco: end, taxa: Number.isFinite(taxaEntrega) ? String(taxaEntrega) : '', frete_gratis: freteGratis, pago_agora: pagoAgora,
        } : {}),
        recebido: forma === 'dinheiro' && Number.isFinite(valorRecebido) ? String(valorRecebido) : '',
        desconto: valorDesconto > 0 ? String(valorDesconto) : '', cozinha, obs: obsPedido,
        cliente_nome: mesaFixa ? mesaFixa.cliente_nome ?? '' : cliNome,
        cliente_telefone: mesaFixa ? mesaFixa.cliente_telefone ?? '' : digitos(cliTel),
      },
    });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    const v = data as { id: string; numero: number; total: number; troco: number | null };
    if (modo === 'entrega') {
      toast(`Entrega #${v.numero} criada${freteGratis ? ' com frete grátis' : ''}. Ela já aparece no app dos entregadores.`, 'ok');
      setConcluida({ ...v, forma: pagoAgora ? forma : null, troco: pagoAgora ? v.troco : null });
    } else if (modo === 'mesa') {
      toast(`Pedido #${v.numero} lançado na ${mesaFixa?.nome ?? mesas.find((m) => m.id === mesaId)?.nome ?? 'mesa'}.`, 'ok');
      aoLancar?.();
      conta?.aoAba('conta');
    } else setConcluida({ ...v, forma });
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

  // Mostra só a categoria escolhida (e, se quiser, uma subcategoria dela)
  const catAtual = principais.some((c) => c.id === catAtiva) ? catAtiva : principais[0]?.id ?? '';
  const daCategoria = secoes.filter((x) => x.principal === catAtual);
  const visiveis = daCategoria.some((x) => x.id === subAtiva) ? daCategoria.filter((x) => x.id === subAtiva) : daCategoria;
  function irPara(id: string) {
    setCatAtiva(id);
    setSubAtiva('');
    setBusca('');
    listaRef.current?.scrollTo({ top: 0 });
  }
  function irSub(id: string) {
    setSubAtiva(id);
    listaRef.current?.scrollTo({ top: 0 });
  }

  const cartao = (p: ProdutoMesa) => {
    const n = qtdNoPedido(p.id);
    return (
      <button key={p.id} type="button" className={cx('pdv-prod', !p.disponivel && 'esgotado', n > 0 && 'no-pedido')} disabled={!p.disponivel} onClick={() => adicionar(p)} title={nomeItem(p)}>
        <span className="pdv-prod__foto">
          <FotoProduto p={p} classe="pdv-prod__img" />
          {!p.disponivel && <em>{p.motivo === 'sem_preco' ? 'Sem preço' : 'Esgotado'}</em>}
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
                {l.texto && <small className="pdv-linha__adic">{l.texto}</small>}
                {editando === l.chave ? (
                  <div className="pdv-linha__obs-editar">
                    <input
                      className="input pdv-linha__obs-input"
                      autoFocus
                      maxLength={140}
                      defaultValue={l.obs}
                      placeholder="Ex.: sem gelo"
                      onBlur={(e) => { mudarObs(l.chave, e.target.value.trim()); setEditando(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                    />
                    {/* Salvar: o campo perde o foco e grava (o mesmo do Enter) */}
                    <button type="button" className="pdv-linha__obs-ok" onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement | null)?.blur()} aria-label="Salvar observação">
                      <Check size={15} strokeWidth={2.8} />
                    </button>
                  </div>
                ) : (
                  <div className="pdv-linha__acoes">
                    <button type="button" className="pdv-linha__editar" onClick={() => setEditandoItem(l)}
                      title={gruposDe(p).length ? 'Trocar sabores, adicionais, quantidade ou observação' : 'Trocar quantidade ou observação'}>
                      <Pencil size={12} /> Editar
                    </button>
                    <button type="button" className="pdv-linha__obs" onClick={() => setEditando(l.chave)}>
                      <PencilLine size={12} /> {l.obs ? `“${l.obs}”` : 'Observação'}
                    </button>
                  </div>
                )}
              </div>
              <span className="pdv-linha__preco">{brl(precoLinha(l, p) * l.qtd)}</span>
            </div>
          );
        })}
      </div>

      <div className="pdv-pedido__rodape">
        <div className="pdv-extras">
          <button type="button" className={cx('pdv-chip', (verObs || obsPedido) && 'ativo')} onClick={() => { setRascunhoObs(obsPedido); setVerObs((v) => !v); }}><MessageSquareText size={14} /> Observação</button>
          <button type="button" className={cx('pdv-chip', (verDesconto || desconto) && 'ativo')} onClick={() => setVerDesconto((v) => !v)} disabled={!podeBalcao}><Wallet size={14} /> Desconto</button>
        </div>
        {verObs ? (
          <div className="pdv-obs-editar">
            <textarea className="textarea pdv-obs" rows={2} maxLength={300} value={rascunhoObs} autoFocus onChange={(e) => setRascunhoObs(e.target.value)} placeholder="Observação do pedido (ex.: trazer as bebidas primeiro)"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setObsPedido(rascunhoObs.trim()); setVerObs(false); } }} />
            <div className="pdv-obs-editar__acoes">
              <button type="button" className="btn btn--fantasma btn--sm" onClick={() => setVerObs(false)}>Cancelar</button>
              <button type="button" className="btn btn--primario btn--sm" onClick={() => { setObsPedido(rascunhoObs.trim()); setVerObs(false); if (rascunhoObs.trim()) toast('Observação salva no pedido.', 'ok'); }}><Check size={15} /> Salvar</button>
            </div>
          </div>
        ) : obsPedido ? (
          <div className="pdv-obs-salva">
            <MessageSquareText size={15} />
            <span>{obsPedido}</span>
            <button type="button" className="icone-btn" onClick={() => { setRascunhoObs(obsPedido); setVerObs(true); }} aria-label="Editar observação"><PencilLine size={15} /></button>
            <button type="button" className="icone-btn" onClick={() => setObsPedido('')} aria-label="Remover observação"><X size={15} /></button>
          </div>
        ) : null}

        <div className="pdv-totais">
          <div><span>Subtotal</span><span>{brl(subtotal)}</span></div>
          {(verDesconto || desconto) && (
            <div className="pdv-totais__desconto">
              <span>Desconto</span>
              <input className={cx('input', !descontoOk && 'input--erro')} value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="R$ ou %" inputMode="decimal" aria-label="Desconto em reais ou porcentagem" />
              {descontoOk && valorDesconto > 0 && <em>− {brl(valorDesconto)}</em>}
            </div>
          )}
          {modo === 'entrega' && (
            <>
              <div className="pdv-totais__entrega">
                <span><Bike size={14} /> Entrega</span>
                <input className={cx('input', !taxaOk && 'input--erro', freteGratis && 'riscado')} value={taxaTxt} onChange={(e) => { setTaxaTxt(mascaraPreco(e.target.value)); setTaxaManual(true); }} placeholder="0,00" inputMode="decimal" aria-label="Taxa de entrega" />
                {freteGratis && <em className="pdv-gratis">Grátis</em>}
              </div>
              <div className="pdv-frete">
                <Switch marcado={freteGratis} aoMudar={(v) => setFreteManual(v)}>
                  <span><Gift size={15} /> Frete grátis{freteHoje ? ' (promoção de hoje)' : ''}</span>
                </Switch>
              </div>
              <div className="pdv-corrida"><span>Corrida do entregador</span><b>{brl(corridaFixa ?? (Number.isFinite(taxaEntrega) ? taxaEntrega : 0))}</b></div>
            </>
          )}
          <div className="pdv-totais__total"><span>Total</span><strong>{brl(total)}</strong></div>
        </div>

        {mesaFixa ? <ClienteMesa key={mesaFixa.id} mesa={mesaFixa} aoSalvar={() => aoLancar?.()} /> : (
          <div className="pdv-cliente">
            <input className="input" inputMode="tel" value={mascaraTelefone(cliTel)} onChange={(e) => setCliTel(digitos(e.target.value))} placeholder={modo === 'entrega' ? 'WhatsApp do cliente *' : 'WhatsApp (opcional)'} aria-label="WhatsApp do cliente" />
            <input className="input" value={cliNome} maxLength={80} onChange={(e) => setCliNome(e.target.value)} placeholder={modo === 'entrega' ? 'Nome do cliente *' : 'Nome do cliente'} aria-label="Nome do cliente" />
          </div>
        )}
        {modo === 'entrega' && (
          <div className="pdv-endereco">
            <input className="input pdv-endereco__rua" value={end.rua} maxLength={120} onChange={(e) => setEnd({ ...end, rua: e.target.value })} placeholder="Rua *" aria-label="Rua" />
            <input className="input pdv-endereco__num" value={end.numero} maxLength={20} onChange={(e) => setEnd({ ...end, numero: e.target.value })} placeholder="Nº *" aria-label="Número" />
            <input className="input" value={end.bairro} maxLength={80} list="pdv-bairros" onChange={(e) => { setEnd({ ...end, bairro: e.target.value }); setTaxaManual(false); }} placeholder="Bairro *" aria-label="Bairro" />
            <input className="input" value={end.complemento} maxLength={80} onChange={(e) => setEnd({ ...end, complemento: e.target.value })} placeholder="Complemento" aria-label="Complemento" />
            <input className="input pdv-endereco__ref" value={end.referencia} maxLength={120} onChange={(e) => setEnd({ ...end, referencia: e.target.value })} placeholder="Ponto de referência" aria-label="Ponto de referência" />
            {r.entrega_modo === 'bairro' && (
              <datalist id="pdv-bairros">{(r.entrega_bairros ?? []).map((b) => <option key={b.nome} value={b.nome}>{brl(Number(b.taxa))}</option>)}</datalist>
            )}
          </div>
        )}

        {mesaFixa ? null : modo === 'mesa' ? (
          <select className="select" value={mesaId} onChange={(e) => setMesaId(e.target.value)} aria-label="Mesa">
            <option value="">Escolha a mesa…</option>
            {mesas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        ) : (
          <>
            {modo === 'entrega' && (
              <div className="pdv-quando" role="radiogroup" aria-label="Quando o cliente paga">
                <button type="button" role="radio" aria-checked={!pagoAgora} className={cx(!pagoAgora && 'ativo')} onClick={() => setPagoAgora(false)}>Paga na entrega</button>
                <button type="button" role="radio" aria-checked={pagoAgora} className={cx(pagoAgora && 'ativo')} onClick={() => setPagoAgora(true)}>Já pagou aqui</button>
              </div>
            )}
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
                <input className="input" inputMode="decimal" value={recebido} onChange={(e) => setRecebido(mascaraPreco(e.target.value))} placeholder={modo === 'entrega' && !pagoAgora ? 'Troco para quanto?' : 'Valor recebido'} aria-label="Valor recebido" />
                <div className="pdv-troco__atalhos">
                  {[...new Set([Math.ceil(total), Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, 100])].filter((v) => v >= total && v > 0).slice(0, 3).map((v) => (
                    <button key={v} type="button" className="pdv-chip" onClick={() => setRecebido(precoParaTexto(v))}>{brl(v)}</button>
                  ))}
                </div>
                {troco !== null && <p className={cx('pdv-troco__valor', troco < 0 && 'falta')}>{troco < 0 ? `Faltam ${brl(-troco)}` : modo === 'entrega' && !pagoAgora ? `O entregador leva ${brl(troco)} de troco` : `Troco: ${brl(troco)}`}</p>}
              </div>
            )}
          </>
        )}

        <div className="pdv-cozinha">
          <Switch marcado={cozinha} aoMudar={setCozinhaManual}>
            <span><ChefHat size={15} /> Enviar para a cozinha</span>
          </Switch>
          {modo === 'balcao' && <small>{cozinha ? 'Vai para Pedidos e imprime na cozinha.' : 'Entregue na hora: a venda já fica concluída.'}</small>}
          {modo === 'entrega' && <small>{cozinha ? 'Vai para a cozinha; o entregador é avisado quando ficar pronto.' : 'Já está pronto: vai direto para os entregadores.'}</small>}
        </div>

      </div>
      <div className="pdv-pedido__acao">
        <button type="button" className="btn btn--primario btn--lg btn--bloco pdv-gerar" disabled={!!motivoBloqueio || enviando} onClick={() => void gerar()}>
          {enviando ? 'Gerando…' : motivoBloqueio || (modo === 'mesa' ? `Lançar na ${mesaFixa ? mesaFixa.nome : 'mesa'} · ${brl(total)}` : modo === 'entrega' ? `Enviar entrega · ${brl(total)}` : `Gerar pedido · ${brl(total)}`)}
          <kbd>Ctrl + Enter</kbd>
        </button>
      </div>
    </div>
  );

  return (
    <div className="pdv">
      {cabecalho ?? <header className="pdv__cab">
        <h1>Pedidos balcão (PDV)</h1>
        <div className="pdv__modos" role="tablist">
          <button role="tab" aria-selected={modo === 'balcao'} className={cx(modo === 'balcao' && 'ativo')} disabled={!podeBalcao} onClick={() => setModo('balcao')}>
            <ShoppingBasket size={17} /> Balcão <span>venda rápida</span>
          </button>
          <button role="tab" aria-selected={modo === 'mesa'} className={cx(modo === 'mesa' && 'ativo')} onClick={() => setModo('mesa')}>
            <LayoutGrid size={17} /> Mesas <span>lançar na conta</span>
          </button>
          <button role="tab" aria-selected={modo === 'entrega'} className={cx(modo === 'entrega' && 'ativo')} disabled={!podeBalcao} onClick={() => setModo('entrega')}>
            <Bike size={17} /> Entrega <span>levar até o cliente</span>
          </button>
        </div>
      </header>}

      {cobraAgora && caixa === null && (
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
                <button key={c.id} type="button" className={cx('pdv-cat', !termo && catAtual === c.id && 'ativa')} onClick={() => irPara(c.id)}>{c.nome}</button>
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
              ) : (
                <>
                  <header className="pdv-cab-cat">
                    <h2>{principais.find((c) => c.id === catAtual)?.nome}</h2>
                    {daCategoria.length > 1 && (
                      <div className="pdv-subs" role="tablist">
                        <button type="button" role="tab" aria-selected={visiveis.length > 1} className={cx('pdv-sub', visiveis.length > 1 && 'ativa')} onClick={() => irSub('')}>Todos</button>
                        {daCategoria.map((x) => (
                          <button key={x.id} type="button" role="tab" aria-selected={visiveis.length === 1 && visiveis[0].id === x.id} className={cx('pdv-sub', visiveis.length === 1 && visiveis[0].id === x.id && 'ativa')} onClick={() => irSub(x.id)}>
                            {x.nome} <small>{x.itens.length}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </header>
                  {visiveis.map((sec) => (
                    <section key={sec.id} className="pdv-secao">
                      {visiveis.length > 1 && <h2>{sec.nome}</h2>}
                      <div className="pdv-grade">{sec.itens.map(cartao)}</div>
                    </section>
                  ))}
                </>
              )}
            </div>
          </div>
        </section>

        <aside className={cx('pdv__pedido', folhaAberta && 'aberta')}>
          {conta ? (
            <div className="pdv-pedido lm-painel">
              <div className="lm-abas" role="tablist" aria-label="Pedido ou conta">
                <button type="button" role="tab" aria-selected={conta.aba === 'pedido'} className={cx(conta.aba === 'pedido' && 'ativo')} onClick={() => conta.aoAba('pedido')}>
                  <ShoppingBasket size={16} /> Novo pedido {qtdItens > 0 && <small>{qtdItens}</small>}
                </button>
                <button type="button" role="tab" aria-selected={conta.aba === 'conta'} className={cx(conta.aba === 'conta' && 'ativo')} onClick={() => conta.aoAba('conta')}>
                  <Receipt size={16} /> Conta <b>{brl(conta.total)}</b>
                </button>
                <button type="button" className="icone-btn pdv-pedido__fechar" onClick={() => setFolhaAberta(false)} aria-label="Fechar"><X size={18} /></button>
              </div>
              {conta.aba === 'conta' ? conta.painel : pedido}
            </div>
          ) : pedido}
        </aside>
        {folhaAberta && <div className="pdv__fundo" onClick={() => setFolhaAberta(false)} aria-hidden="true" />}
      </div>

      {/* Celular/tablet em pé: barra que abre o pedido */}
      <button type="button" className={cx('pdv__barra', qtdItens > 0 && 'com-itens')} onClick={() => { conta?.aoAba(qtdItens > 0 ? 'pedido' : 'conta'); setFolhaAberta(true); }}>
        <span className="pdv__barra-qtd">{qtdItens}</span>
        <span>{conta && !qtdItens ? 'Ver conta' : 'Ver pedido'}</span>
        <strong>{brl(conta && !qtdItens ? conta.total : total)}</strong>
        <ChevronUp size={18} />
      </button>

      {escolhendo && (
        <ModalProduto
          key={escolhendo.id}
          p={escolhendo}
          aoFechar={() => setEscolhendo(null)}
          aoAdicionar={(qtd, obs, a) => { adicionar(escolhendo, qtd, obs, a ?? { escolhas: [], extra: 0, texto: '' }); setEscolhendo(null); }}
          jaNoCarrinho={qtdNoPedido(escolhendo.id)}
          grupos={gruposDe(escolhendo)}
        />
      )}

      {editandoItem && porId.get(editandoItem.produto_id) && (() => {
        const p = porId.get(editandoItem.produto_id)!;
        return (
          <ModalProduto
            key={`editar-${editandoItem.chave}`}
            p={p}
            edicao={{ qtd: editandoItem.qtd, obs: editandoItem.obs, escolhas: editandoItem.adicionais ?? [] }}
            aoFechar={() => setEditandoItem(null)}
            aoAdicionar={(qtd, obs, a) => { salvarEdicao(editandoItem, p, qtd, obs, a); setEditandoItem(null); }}
            jaNoCarrinho={qtdNoPedido(p.id) - editandoItem.qtd}
            grupos={gruposDe(p)}
          />
        );
      })()}

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
